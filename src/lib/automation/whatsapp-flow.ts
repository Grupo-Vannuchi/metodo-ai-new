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
import { keywordMatches, samePhone } from "@/lib/automation/match";
import {
  parseActions,
  parseConfig,
  WHATSAPP_ONLY_ACTIONS,
  type RuleAction,
  type WhatsappTriggerConfig,
} from "@/lib/automation/types";

/**
 * "whatsapp_message" automations: a message from an allowed number carrying the
 * rule's keyword opens a session on that conversation; the rule's questions are
 * then sent one at a time, exactly as written, and each customer reply is saved
 * as the answer to the pending question. When the last one is answered, the flow
 * creates the opportunity and runs the rule's remaining actions. No AI involved.
 * Runs as system (webhook), so every query carries `organizationId` explicitly.
 */

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ACTOR = "Automação WhatsApp";
const PLEASE_TYPE = "Pode me responder por escrito, por favor?";
const DEFAULT_FINAL = "Obrigado! Recebemos suas informações.";

type AskQuestions = Extract<RuleAction, { type: "ask_questions" }>;
type FlowRule = { id: string; name: string; wa: WhatsappTriggerConfig; ask: AskQuestions; actions: RuleAction[] };
type Answers = Record<string, string>;
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
 *  conversation, or the keyword from an allowed number. Opens the session. */
async function claimFlow(organizationId: string, connectionId: string, m: ParsedInbound): Promise<Claim | null> {
  const sender = m.remoteJid.split("@")[0] ?? "";
  const rules = (await flowRules(organizationId, connectionId)).filter((r) =>
    r.wa.numbers.some((n) => samePhone(n, sender)),
  );
  if (rules.length === 0) return null;

  // WhatsApp numbers belong to the Atendimento module: without it the flow is off.
  const org = await prisma.organization.findFirst({
    where: { id: organizationId },
    select: { modules: { where: { status: "ACTIVE" }, select: { moduleId: true } } },
  });
  if (!hasModule(org?.modules.map((x) => x.moduleId) ?? [], "inbox")) return null;

  const conversation = await prisma.conversation.findFirst({
    where: { organizationId, connectionId, remoteJid: m.remoteJid },
    select: { id: true, contactId: true },
  });
  if (!conversation) return null;
  const base = { organizationId, connectionId, conversationId: conversation.id, contactId: conversation.contactId };

  const now = new Date();
  const open = await prisma.automationSession.findFirst({
    where: { organizationId, conversationId: conversation.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true, ruleId: true, lastInboundAt: true },
  });
  if (open) {
    const rule = rules.find((r) => r.id === open.ruleId);
    const expired = now.getTime() - open.lastInboundAt.getTime() > SESSION_TTL_MS;
    if (rule && !expired) {
      await prisma.automationSession.updateMany({
        where: { id: open.id, organizationId },
        data: { lastInboundAt: now },
      });
      return { ...base, rule, sessionId: open.id };
    }
    // Expired, or its rule was disabled/edited out from under it.
    await prisma.automationSession.updateMany({
      where: { id: open.id, organizationId, status: "ACTIVE" },
      data: { status: expired ? "EXPIRED" : "CANCELED", finishedAt: now },
    });
  }

  const rule = rules.find((r) => keywordMatches(m.body ?? "", r.wa.keyword, r.wa.match));
  if (!rule) return null;

  // The session starts at the keyword message (ingested just before this runs),
  // so everything after the bot's first message counts as answers.
  const trigger = m.providerMessageId
    ? await prisma.message.findFirst({
        where: { organizationId, conversationId: conversation.id, providerMessageId: m.providerMessageId },
        select: { createdAt: true },
      })
    : null;
  const created = await prisma.automationSession.create({
    data: {
      organizationId,
      ruleId: rule.id,
      conversationId: conversation.id,
      lastInboundAt: now,
      createdAt: trigger?.createdAt ?? now,
    },
    select: { id: true },
  });
  return { ...base, rule, sessionId: created.id };
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
    const ask = actions[0];
    if (!wa || wa.connectionId !== connectionId || !wa.keyword) return [];
    if (ask?.type !== "ask_questions" || ask.questions.length === 0) return [];
    return [{ id: r.id, name: r.name, wa, ask, actions }];
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

  const send = (text: string) => sendReply(claim, m.remoteJid, text);
  const { questions } = rule.ask;

  const history = await prisma.message.findMany({
    where: { organizationId, conversationId, createdAt: { gte: session.createdAt } },
    orderBy: { createdAt: "asc" },
    select: { direction: true, agentReply: true, body: true },
  });
  const isBot = history.map((h) => h.direction === "OUTBOUND" && h.agentReply);
  const botTexts = history.filter((_, i) => isBot[i]).map((h) => (h.body ?? "").trim());
  const answers = readAnswers(session.answers);
  const current = questions.findIndex((_, i) => !answers[String(i)]);
  if (current === -1) return;

  // The pending question hasn't been sent in this session yet: send it now
  // (after the welcome message when it's the bot's first turn).
  if (!botTexts.includes(questions[current].label.trim())) {
    if (botTexts.length === 0 && rule.ask.firstMessage) await send(rule.ask.firstMessage);
    await send(questions[current].label);
    return;
  }

  // Everything the customer wrote since the bot's last message is the answer.
  const lastBot = isBot.lastIndexOf(true);
  const reply = history
    .slice(lastBot + 1)
    .filter((h) => h.direction === "INBOUND")
    .map((h) => (h.body ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 500);
  if (!reply) {
    await send(PLEASE_TYPE);
    return;
  }

  answers[String(current)] = reply;
  await prisma.automationSession.updateMany({
    where: { id: sessionId, organizationId },
    data: { answers },
  });

  if (current + 1 < questions.length) {
    await send(questions[current + 1].label);
    return;
  }

  // Last answer is in. Close first so a concurrent turn can't finish twice.
  if (!(await closeSession(claim))) return;
  const conn = await prisma.integrationConnection.findFirst({
    where: { id: claim.connectionId, organizationId },
    select: { ownerId: true },
  });
  const ownerId = await resolveOwnerId(organizationId, conn?.ownerId ?? null);
  await send(rule.ask.finalMessage || DEFAULT_FINAL);
  await finishFlow(claim, ownerId, answers);
}

/** Store the answers on the contact/opportunity and run the rule's other actions. */
async function finishFlow(claim: Claim, ownerId: string | null, answers: Answers): Promise<void> {
  const { organizationId, contactId, rule } = claim;
  if (!contactId) return;
  const db = tenantDb(organizationId);
  const questions = rule.ask.questions;
  const field = (f: "name" | "email") =>
    questions.map((q, i) => (q.field === f ? answers[String(i)] : undefined)).find(Boolean);
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
  const notes = [
    ...questions.map((q, i) => `${q.label}: ${answers[String(i)] ?? "—"}`),
    `Origem: WhatsApp (automação "${rule.name}")`,
  ].join("\n");
  const opp = await insertBotOpportunity(organizationId, {
    title: `${rule.name} · ${contact?.name ?? ""}`,
    value: 0,
    notes,
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

/** Close the session if still open; false when another turn already did. */
async function closeSession(claim: Claim): Promise<boolean> {
  const res = await prisma.automationSession.updateMany({
    where: { id: claim.sessionId, organizationId: claim.organizationId, status: "ACTIVE" },
    data: { status: "COMPLETED", finishedAt: new Date() },
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
