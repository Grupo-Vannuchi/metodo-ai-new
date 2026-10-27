import "server-only";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import { loadEvoCredsById } from "@/lib/integrations/evolution-creds";
import { getChannelAdapter } from "@/lib/integrations/channels";
import { hasModule } from "@/config/modules";
import type { ParsedInbound } from "@/lib/whatsapp/inbound";
import { isAgentOverDailyLimit } from "@/lib/whatsapp-agent/quota";
import { insertBotOpportunity } from "@/lib/whatsapp-agent/tools";
import { DEBOUNCE_MS, recordAgentReply, resolveOwnerId, scheduleAgentReply, sleep } from "@/lib/whatsapp-agent/pipeline";
import { runActionsForOpportunity } from "@/lib/automation/engine";
import { keywordMatches } from "@/lib/automation/match";
import { formatMenu, invalidMenuReply } from "@/lib/automation/menu";
import {
  activePath,
  BURST_GRACE_MS,
  canStartOnAnyMessage,
  MENU_KEY,
  MENU_LABEL_KEY,
  opportunityNotes,
  opportunityTitle,
  pickMenuChoice,
  sessionFitsRule,
  type ActivePath,
  type Answers,
} from "@/lib/automation/flow-core";
import {
  isFlowStep,
  MIN_MENU_OPTIONS,
  parseActions,
  parseConfig,
  WHATSAPP_ONLY_ACTIONS,
  type FlowStep,
  type RuleAction,
  type WhatsappTriggerConfig,
} from "@/lib/automation/types";

/**
 * "whatsapp_message" automations: a message carrying the rule's keyword — or,
 * for an "any message" rule, any message on a new or quiet conversation — opens
 * a session on that conversation. The rule's first step then runs exactly as
 * written: fixed questions one at a time, or a numbered menu whose chosen option
 * has its own questions and closing message. Each customer reply is saved as the
 * answer to the pending question. When the last one is answered, the flow
 * creates the opportunity and runs the rule's remaining actions. No AI involved.
 * Runs as system (webhook), so every query carries `organizationId` explicitly.
 */

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ACTOR = "Automação WhatsApp";
const PLEASE_TYPE = "Pode me responder por escrito, por favor?";
const DEFAULT_FINAL = "Obrigado! Recebemos suas informações.";

type FlowRule = { id: string; name: string; wa: WhatsappTriggerConfig; step: FlowStep; actions: RuleAction[] };
type Claim = {
  organizationId: string;
  connectionId: string;
  conversationId: string;
  contactId: string | null;
  rule: FlowRule;
  sessionId: string;
};

/**
 * Entry point from the Evolution webhook (fire-and-forget). A message that
 * belongs to a flow is handled here and never reaches the AI agent; anything
 * else falls through to the agent exactly as before.
 */
export function scheduleInboundAutomation(organizationId: string, connectionId: string, m: ParsedInbound): void {
  if (m.fromMe || m.isGroup) return;
  void (async () => {
    const claim = await claimFlow(organizationId, connectionId, m).catch((e) => {
      console.error("[automation-flow] claim failed", e);
      return null;
    });
    if (!claim) return scheduleAgentReply(organizationId, connectionId, m);
    await runFlowTurn(claim, m).catch((e) => console.error("[automation-flow] turn failed", e));
  })();
}

/** Decide whether this message belongs to a flow: an open session on the
 *  conversation, a keyword, or an "any message" rule. Opens the session. */
async function claimFlow(organizationId: string, connectionId: string, m: ParsedInbound): Promise<Claim | null> {
  const rules = await flowRules(organizationId, connectionId);
  if (rules.length === 0) return null;

  // WhatsApp numbers belong to the Atendimento module: without it the flow is off.
  const org = await prisma.organization.findFirst({
    where: { id: organizationId },
    select: { modules: { where: { status: "ACTIVE" }, select: { moduleId: true } } },
  });
  if (!hasModule(org?.modules.map((x) => x.moduleId) ?? [], "inbox")) return null;

  const conversation = await prisma.conversation.findFirst({
    where: { organizationId, connectionId, remoteJid: m.remoteJid },
    select: { id: true, contactId: true, assignedToId: true },
  });
  if (!conversation) return null;
  const base = { organizationId, connectionId, conversationId: conversation.id, contactId: conversation.contactId };

  const now = new Date();
  const open = await prisma.automationSession.findFirst({
    where: { organizationId, conversationId: conversation.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true, ruleId: true, lastInboundAt: true, answers: true },
  });
  if (open) {
    const rule = rules.find((r) => r.id === open.ruleId);
    const expired = now.getTime() - open.lastInboundAt.getTime() > SESSION_TTL_MS;
    if (rule && !expired && sessionFitsRule(rule.step, readAnswers(open.answers))) {
      await prisma.automationSession.updateMany({
        where: { id: open.id, organizationId },
        data: { lastInboundAt: now },
      });
      return { ...base, rule, sessionId: open.id };
    }
    // Expired, or its rule was disabled/edited out from under it. This same
    // message is then judged from scratch below.
    await prisma.automationSession.updateMany({
      where: { id: open.id, organizationId, status: "ACTIVE" },
      data: { status: expired ? "EXPIRED" : "CANCELED", finishedAt: now },
    });
  }

  // The session starts at this message (ingested just before this runs), so
  // everything after the bot's first message counts as answers.
  const trigger = m.providerMessageId
    ? await prisma.message.findFirst({
        where: { organizationId, conversationId: conversation.id, providerMessageId: m.providerMessageId },
        select: { id: true, createdAt: true },
      })
    : null;
  const arrivedAt = trigger?.createdAt ?? now;

  const rule =
    rules.find((r) => r.wa.start === "keyword" && keywordMatches(m.body ?? "", r.wa.keyword, r.wa.match)) ??
    (await anyMessageStart(organizationId, conversation, rules, trigger?.id ?? null, arrivedAt));
  if (!rule) return null;

  const created = await prisma.automationSession.create({
    data: {
      organizationId,
      ruleId: rule.id,
      conversationId: conversation.id,
      lastInboundAt: now,
      createdAt: arrivedAt,
    },
    select: { id: true },
  });
  await keepNewestSession(organizationId, conversation.id);
  return { ...base, rule, sessionId: created.id };
}

/** The "any message" rule of this number, when this message may start it. */
async function anyMessageStart(
  organizationId: string,
  conversation: { id: string; assignedToId: string | null },
  rules: FlowRule[],
  triggerId: string | null,
  arrivedAt: Date,
): Promise<FlowRule | null> {
  const rule = rules.find((r) => r.wa.start === "any");
  if (!rule) return null;
  const conversationId = conversation.id;
  const [activity, newest] = await Promise.all([
    // The lead's own messages of this same burst aren't earlier activity.
    prisma.message.findFirst({
      where: {
        organizationId,
        conversationId,
        ...(triggerId ? { id: { not: triggerId } } : {}),
        createdAt: { lte: arrivedAt },
        OR: [{ direction: "OUTBOUND" }, { createdAt: { lt: new Date(arrivedAt.getTime() - BURST_GRACE_MS) } }],
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    // The conversation's newest session, whatever its rule: an abandoned
    // session of this rule stops counting once another flow ran after it.
    prisma.automationSession.findFirst({
      where: { organizationId, conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { ruleId: true, status: true, createdAt: true },
    }),
  ]);
  const lastSession = newest?.ruleId === rule.id ? newest : null;
  const starts = canStartOnAnyMessage({
    arrivedAt,
    assigned: !!conversation.assignedToId,
    lastActivityAt: activity?.createdAt ?? null,
    lastSession,
    humanReplyAfterLastSession: lastSession ? await humanWroteSince(organizationId, conversationId, lastSession.createdAt) : false,
  });
  return starts ? rule : null;
}

/** A person (not the bot) wrote to the lead after `since`. */
async function humanWroteSince(organizationId: string, conversationId: string, since: Date): Promise<boolean> {
  const message = await prisma.message.findFirst({
    where: { organizationId, conversationId, direction: "OUTBOUND", agentReply: false, createdAt: { gt: since } },
    select: { id: true },
  });
  return !!message;
}

/** The team took the conversation: it's assigned to someone, or a person wrote after `since`. */
async function teamTookOver(organizationId: string, conversationId: string, since: Date): Promise<boolean> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { assignedToId: true },
  });
  return !!conversation?.assignedToId || (await humanWroteSince(organizationId, conversationId, since));
}

/** Two messages of a burst can each open a session at the same moment: keep
 *  the newest one active so the leftover never answers later. */
async function keepNewestSession(organizationId: string, conversationId: string): Promise<void> {
  const newest = await prisma.automationSession.findFirst({
    where: { organizationId, conversationId, status: "ACTIVE" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (!newest) return;
  await prisma.automationSession.updateMany({
    where: { organizationId, conversationId, status: "ACTIVE", id: { not: newest.id } },
    data: { status: "CANCELED", finishedAt: new Date() },
  });
}

/** Enabled, well-formed WhatsApp rules listening on this connection. */
async function flowRules(organizationId: string, connectionId: string): Promise<FlowRule[]> {
  const rows = await prisma.automationRule.findMany({
    where: { organizationId, enabled: true, trigger: "whatsapp_message" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, actions: true, config: true },
  });
  return rows.flatMap((r) => {
    const wa = parseConfig(r.config).whatsapp;
    const actions = parseActions(r.actions);
    const step = actions[0];
    if (!wa || wa.connectionId !== connectionId) return [];
    if (wa.start === "keyword" && !wa.keyword) return [];
    if (!isFlowStep(step)) return [];
    if (step.type === "ask_questions" ? step.questions.length === 0 : step.options.length < MIN_MENU_OPTIONS) return [];
    return [{ id: r.id, name: r.name, wa, step, actions }];
  });
}

async function runFlowTurn(claim: Claim, m: ParsedInbound): Promise<void> {
  const { organizationId, conversationId, rule, sessionId } = claim;

  // Debounce: a burst of messages is answered once, by the job of the last one.
  await sleep(DEBOUNCE_MS);
  const latestInbound = await prisma.message.findFirst({
    where: { organizationId, conversationId, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
    select: { providerMessageId: true },
  });
  if (!latestInbound || (m.providerMessageId && latestInbound.providerMessageId !== m.providerMessageId)) return;
  if (await isAgentOverDailyLimit(organizationId)) return;

  const session = await prisma.automationSession.findFirst({
    where: { id: sessionId, organizationId, status: "ACTIVE" },
    select: { answers: true, createdAt: true },
  });
  if (!session) return;

  // An "any message" flow steps aside once the team takes the conversation:
  // the lead is talking to a person now, not to the menu. (Keyword flows keep
  // going, as before: the lead asked for them.)
  if (rule.wa.start === "any" && (await teamTookOver(organizationId, conversationId, session.createdAt))) {
    await prisma.automationSession.updateMany({
      where: { id: sessionId, organizationId, status: "ACTIVE" },
      data: { status: "HANDOFF", finishedAt: new Date() },
    });
    return;
  }

  const send = (text: string) => sendReply(claim, m.remoteJid, text);
  const { step } = rule;

  const history = await prisma.message.findMany({
    where: { organizationId, conversationId, createdAt: { gte: session.createdAt } },
    orderBy: { createdAt: "asc" },
    select: { direction: true, agentReply: true, body: true },
  });
  const isBot = history.map((h) => h.direction === "OUTBOUND" && h.agentReply);
  const botTexts = history.filter((_, i) => isBot[i]).map((h) => (h.body ?? "").trim());
  const answers = readAnswers(session.answers);
  // Everything the customer wrote since the bot's last message.
  const lastBot = isBot.lastIndexOf(true);
  const replies = history
    .slice(lastBot + 1)
    .filter((h) => h.direction === "INBOUND")
    .map((h) => (h.body ?? "").trim())
    .filter(Boolean);

  if (step.type === "ask_menu" && !(MENU_KEY in answers)) {
    const labels = step.options.map((o) => o.label);
    const menu = formatMenu(step.question, labels);
    const invalid = invalidMenuReply(labels);
    // The menu hasn't been sent in this session yet: send it now (after the
    // welcome message when it's the bot's first turn).
    if (!botTexts.includes(menu.trim()) && !botTexts.includes(invalid.trim())) {
      if (botTexts.length === 0 && step.firstMessage) await send(step.firstMessage);
      await send(menu);
      return;
    }
    if (replies.length === 0) {
      await send(PLEASE_TYPE);
      return;
    }
    const choice = pickMenuChoice(replies, labels);
    if (choice === null) {
      await send(invalid);
      return;
    }
    answers[MENU_KEY] = String(choice);
    answers[MENU_LABEL_KEY] = step.options[choice].label;
    const path = activePath(step, answers)!;
    if (path.questions.length === 0) {
      await finishTurn(claim, send, path, answers);
      return;
    }
    if (await saveAnswers(claim, answers)) await send(path.questions[0].label);
    return;
  }

  const path = activePath(step, answers);
  if (!path) return;
  const { questions } = path;
  const current = questions.findIndex((_, i) => !answers[String(i)]);
  if (current === -1) return;

  // The pending question hasn't been sent in this session yet: send it now
  // (after the welcome message when it's the bot's first turn).
  if (!botTexts.includes(questions[current].label.trim())) {
    if (botTexts.length === 0 && step.firstMessage) await send(step.firstMessage);
    await send(questions[current].label);
    return;
  }

  const reply = replies.join("\n").slice(0, 500);
  if (!reply) {
    await send(PLEASE_TYPE);
    return;
  }

  answers[String(current)] = reply;
  if (current + 1 < questions.length) {
    if (await saveAnswers(claim, answers)) await send(questions[current + 1].label);
    return;
  }
  await finishTurn(claim, send, path, answers);
}

/** Last answer is in: close, say goodbye, then record it all in the CRM. */
async function finishTurn(claim: Claim, send: (text: string) => Promise<void>, path: ActivePath, answers: Answers): Promise<void> {
  // The last answer and the close go in one write: a concurrent turn can't
  // finish twice, and a concurrent claim never sees a finished path still open
  // (it would cancel the session as "no longer fitting" and the lead would be lost).
  if (!(await closeSession(claim, answers))) return;
  const conn = await prisma.integrationConnection.findFirst({
    where: { id: claim.connectionId, organizationId: claim.organizationId },
    select: { ownerId: true },
  });
  const ownerId = await resolveOwnerId(claim.organizationId, conn?.ownerId ?? null);
  await send(path.finalMessage || DEFAULT_FINAL);
  await finishFlow(claim, ownerId, path, answers);
}

/** Store the answers on the contact/opportunity and run the rule's other actions. */
async function finishFlow(claim: Claim, ownerId: string | null, path: ActivePath, answers: Answers): Promise<void> {
  const { organizationId, contactId, rule } = claim;
  if (!contactId) return;
  const db = tenantDb(organizationId);
  const field = (f: "name" | "email") =>
    path.questions.map((q, i) => (q.field === f ? answers[String(i)] : undefined)).find(Boolean);
  const name = field("name")?.slice(0, 120);
  const email = field("email");
  const validEmail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
  if (name || validEmail) {
    await db.contact.updateMany({
      where: { id: contactId },
      data: { ...(name ? { name } : {}), ...(validEmail ? { email: validEmail } : {}) },
    });
  }

  const rest = rule.actions.slice(1);
  if (!rest.some((a) => a.type === "create_opportunity")) return;

  const contact = await db.contact.findFirst({ where: { id: contactId }, select: { name: true } });
  const opp = await insertBotOpportunity(organizationId, {
    title: opportunityTitle(rule.name, path, contact?.name ?? null),
    value: 0,
    notes: opportunityNotes(rule.name, path, answers),
    contactId,
    ownerId,
  });
  if (!opp) return;
  await prisma.automationSession.updateMany({
    where: { id: claim.sessionId, organizationId },
    data: { opportunityId: opp.id },
  });
  const after = rest.filter((a) => !WHATSAPP_ONLY_ACTIONS.includes(a.type));
  await runActionsForOpportunity(organizationId, opp.id, after, ACTOR, rule.id);
}

/** Save the answers while the session is still open; false when it was closed
 *  meanwhile (handed off, cancelled, finished), so nothing more gets sent. */
async function saveAnswers(claim: Claim, answers: Answers): Promise<boolean> {
  const res = await prisma.automationSession.updateMany({
    where: { id: claim.sessionId, organizationId: claim.organizationId, status: "ACTIVE" },
    data: { answers },
  });
  return res.count > 0;
}

/** Store the final answers and close the session if still open; false when
 *  another turn or claim already closed it. */
async function closeSession(claim: Claim, answers: Answers): Promise<boolean> {
  const res = await prisma.automationSession.updateMany({
    where: { id: claim.sessionId, organizationId: claim.organizationId, status: "ACTIVE" },
    data: { answers, status: "COMPLETED", finishedAt: new Date() },
  });
  return res.count > 0;
}

/** Send on the connection the message came in on and tag it as a bot reply. */
async function sendReply(claim: Claim, remoteJid: string, text: string): Promise<void> {
  const creds = await loadEvoCredsById(claim.connectionId);
  if (!creds) return;
  const sent = await getChannelAdapter("WHATSAPP_EVOLUTION").send(creds, { to: remoteJid.split("@")[0], body: text });
  if (!sent.ok) return;
  await recordAgentReply(claim.organizationId, claim.conversationId, text, sent.providerMessageId ?? null);
}

function readAnswers(raw: unknown): Answers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Answers = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}
