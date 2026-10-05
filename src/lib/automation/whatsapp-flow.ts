import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import { getAnthropic } from "@/lib/assistant/client";
import { loadEvoCredsById } from "@/lib/integrations/evolution-creds";
import { getChannelAdapter } from "@/lib/integrations/channels";
import { hasFeatureByModules } from "@/config/modules";
import type { ParsedInbound } from "@/lib/whatsapp/inbound";
import { isAgentOverDailyLimit } from "@/lib/whatsapp-agent/quota";
import { insertBotOpportunity, runAgentTool, type BotContext } from "@/lib/whatsapp-agent/tools";
import {
  CANT_HEAR_AUDIO,
  DEBOUNCE_MS,
  recordAgentReply,
  resolveOwnerId,
  scheduleAgentReply,
  sleep,
  toAlternatingTurns,
  transcribeInboundAudio,
  type Turn,
} from "@/lib/whatsapp-agent/pipeline";
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
 * rule's keyword opens a session on that conversation; the AI then asks the
 * rule's questions one per message, and when every answer is in, the flow
 * creates the opportunity and runs the rule's remaining actions. Runs as system
 * (webhook), so every query carries `organizationId` explicitly.
 */

const FLOW_MODEL = "claude-opus-5-5";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 40;
const MAX_TOOL_ROUNDS = 4;
const ACTOR = "Automação WhatsApp";
const PLEASE_TYPE = "Pode me responder por escrito, por favor?";

type AiCollect = Extract<RuleAction, { type: "ai_collect" }>;
type FlowRule = { id: string; name: string; wa: WhatsappTriggerConfig; ai: AiCollect; actions: RuleAction[] };
type Answers = Record<string, string>;
type Claim = {
  organizationId: string;
  connectionId: string;
  conversationId: string;
  contactId: string | null;
  modules: string[];
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

  // The flow is an AI feature: without the IA module it stays off.
  const org = await prisma.organization.findFirst({
    where: { id: organizationId },
    select: { modules: { where: { status: "ACTIVE" }, select: { moduleId: true } } },
  });
  const modules = org?.modules.map((x) => x.moduleId) ?? [];
  if (!hasFeatureByModules(modules, "whatsapp_agent")) return null;

  const conversation = await prisma.conversation.findFirst({
    where: { organizationId, connectionId, remoteJid: m.remoteJid },
    select: { id: true, contactId: true },
  });
  if (!conversation) return null;
  const base = { organizationId, connectionId, conversationId: conversation.id, contactId: conversation.contactId, modules };

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
  // so the flow's history includes it.
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
    const ai = actions[0];
    if (!wa || wa.connectionId !== connectionId || !wa.keyword) return [];
    if (ai?.type !== "ai_collect" || ai.questions.length === 0) return [];
    return [{ id: r.id, name: r.name, wa, ai, actions }];
  });
}

async function runFlowTurn(claim: Claim, m: ParsedInbound): Promise<void> {
  const { organizationId, connectionId, conversationId, rule, sessionId } = claim;

  // Voice notes are transcribed like the agent does; other media can't answer.
  let fallback: string | null = null;
  if (!(m.body ?? "").trim()) {
    const isAudio = m.type === "AUDIO" || (m.media?.mime ?? "").toLowerCase().startsWith("audio/");
    const transcript = isAudio ? await transcribeInboundAudio(connectionId, m) : "";
    if (!transcript) fallback = isAudio ? CANT_HEAR_AUDIO : PLEASE_TYPE;
  }

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
  if (fallback) {
    await send(fallback);
    return;
  }

  const botTurns = await prisma.message.count({
    where: { organizationId, conversationId, agentReply: true, createdAt: { gte: session.createdAt } },
  });
  if (botTurns === 0 && rule.ai.firstMessage) {
    await send(rule.ai.firstMessage);
    return;
  }

  const anthropic = getAnthropic();
  if (!anthropic) return;

  const history = await prisma.message.findMany({
    where: { organizationId, conversationId, body: { not: null }, createdAt: { gte: session.createdAt } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { direction: true, body: true },
  });
  const turns = toAlternatingTurns(
    history
      .reverse()
      .map((h): Turn => ({ role: h.direction === "INBOUND" ? "user" : "assistant", content: (h.body ?? "").trim() }))
      .filter((t) => t.content),
  );
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") return;

  const conn = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, organizationId },
    select: { ownerId: true },
  });
  const ownerId = await resolveOwnerId(organizationId, conn?.ownerId ?? null);
  const answers = readAnswers(session.answers);
  const reply = await askModel(anthropic, claim, ownerId, answers, turns);

  if (reply.handedOff) {
    await closeSession(claim, "HANDOFF");
    if (reply.text) await send(reply.text);
    return;
  }

  const missing = rule.ai.questions.findIndex((_, i) => !answers[String(i)]);
  if (missing >= 0) {
    await send(reply.text || `${rule.ai.questions[missing].label}?`);
    return;
  }

  // Every answer is in. Close first so a concurrent turn can't finish twice.
  if (!(await closeSession(claim, "COMPLETED"))) return;
  await send(rule.ai.finalMessage || reply.text || "Obrigado! Recebemos suas informações.");
  await finishFlow(claim, ownerId, answers);
}

const SAVE_ANSWERS: Anthropic.Beta.BetaTool = {
  name: "save_answers",
  description:
    "Registra as respostas do cliente às perguntas do atendimento. Chame sempre que o cliente responder uma ou mais perguntas, antes de escrever a próxima mensagem.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "integer", description: "Número da pergunta (1, 2, 3…)." },
            answer: { type: "string", description: "A resposta do cliente, fiel ao que ele disse." },
          },
          required: ["question", "answer"],
          additionalProperties: false,
        },
      },
    },
    required: ["answers"],
    additionalProperties: false,
  },
};

const HANDOFF: Anthropic.Beta.BetaTool = {
  name: "handoff_to_human",
  description:
    "Passa a conversa para um atendente humano e encerra a coleta. Use quando o cliente escolher falar com uma pessoa ou pedir isso. Depois, avise em uma frase curta que um atendente vai continuar.",
  strict: true,
  input_schema: {
    type: "object",
    properties: { reason: { type: "string", description: "Resumo do motivo para o atendente." } },
    required: ["reason"],
    additionalProperties: false,
  },
};

/** One model turn with the save/handoff tools. Mutates `answers` as the model
 *  records them (and persists each save), returns the customer-facing text. */
async function askModel(
  anthropic: Anthropic,
  claim: Claim,
  ownerId: string | null,
  answers: Answers,
  turns: Turn[],
): Promise<{ text: string; handedOff: boolean }> {
  const { rule } = claim;
  const tools = rule.ai.allowHandoff ? [SAVE_ANSWERS, HANDOFF] : [SAVE_ANSWERS];
  const system = buildSystem(rule, answers);
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));
  const botCtx: BotContext = {
    organizationId: claim.organizationId,
    connectionId: claim.connectionId,
    conversationId: claim.conversationId,
    contactId: claim.contactId,
    ownerId,
    modules: claim.modules,
  };

  let text = "";
  let handedOff = false;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await anthropic.beta.messages.create({
      model: FLOW_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      tools,
      messages,
    });
    if (res.stop_reason === "refusal") return { text: "", handedOff };
    text = res.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("\n")
      .trim();
    if (res.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      let out: string;
      if (block.name === "save_answers") {
        out = await saveAnswers(claim, answers, block.input);
      } else if (block.name === "handoff_to_human") {
        handedOff = true;
        out = await runAgentTool(botCtx, "handoff_to_human", (block.input ?? {}) as Record<string, unknown>);
      } else {
        out = `Ferramenta desconhecida: ${block.name}`;
      }
      results.push({ type: "tool_result", tool_use_id: block.id, content: out });
    }
    messages.push({ role: "user", content: results });
  }
  return { text, handedOff };
}

function buildSystem(rule: FlowRule, answers: Answers): string {
  const { ai } = rule;
  const questions = ai.questions.map((q, i) => `${i + 1}. ${q.label}`).join("\n");
  const known = ai.questions
    .map((q, i) => (answers[String(i)] ? `${i + 1}. ${answers[String(i)]}` : null))
    .filter(Boolean)
    .join("\n");
  const lines = [
    "Você atende clientes pelo WhatsApp da empresa e precisa coletar algumas informações com eles.",
    "Responda em português do Brasil, de forma breve e natural, como numa conversa de WhatsApp.",
    "",
    "Perguntas, nesta ordem:",
    questions,
    "",
    "Sempre que o cliente responder uma ou mais perguntas, chame save_answers antes de escrever.",
    "Depois, faça a próxima pergunta que ainda não tem resposta, uma por mensagem. Não repita perguntas já respondidas e não invente respostas.",
    'Se o cliente não quiser responder uma pergunta, registre "não informado" e siga.',
  ];
  if (ai.allowHandoff) {
    lines.push("Se o cliente pedir para falar com uma pessoa, ou escolher essa opção, chame handoff_to_human.");
  }
  if (ai.firstMessage) {
    lines.push("", `A primeira mensagem enviada ao cliente foi:\n"""${ai.firstMessage}"""`);
  }
  lines.push("", `Respostas já registradas:\n${known || "nenhuma"}`);
  if (ai.instructions) lines.push("", "--- Instruções do negócio ---", ai.instructions);
  return lines.join("\n");
}

/** Validate a save_answers call, merge it and persist. */
async function saveAnswers(claim: Claim, answers: Answers, input: unknown): Promise<string> {
  const total = claim.rule.ai.questions.length;
  const list = (input as { answers?: unknown })?.answers;
  if (!Array.isArray(list)) return "Formato inválido: envie answers como lista.";
  for (const item of list) {
    const q = Number((item as { question?: unknown })?.question);
    const a = String((item as { answer?: unknown })?.answer ?? "").trim().slice(0, 500);
    if (Number.isInteger(q) && q >= 1 && q <= total && a) answers[String(q - 1)] = a;
  }
  await prisma.automationSession.updateMany({
    where: { id: claim.sessionId, organizationId: claim.organizationId },
    data: { answers },
  });
  const pending = claim.rule.ai.questions
    .map((q, i) => (answers[String(i)] ? null : `${i + 1}. ${q.label}`))
    .filter(Boolean);
  return pending.length ? `Registrado. Ainda faltam:\n${pending.join("\n")}` : "Registrado. Todas as perguntas foram respondidas.";
}

/** Store the answers on the contact/opportunity and run the rule's other actions. */
async function finishFlow(claim: Claim, ownerId: string | null, answers: Answers): Promise<void> {
  const { organizationId, contactId, rule } = claim;
  if (!contactId) return;
  const db = tenantDb(organizationId);
  const questions = rule.ai.questions;
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
async function closeSession(claim: Claim, status: "COMPLETED" | "HANDOFF"): Promise<boolean> {
  const res = await prisma.automationSession.updateMany({
    where: { id: claim.sessionId, organizationId: claim.organizationId, status: "ACTIVE" },
    data: { status, finishedAt: new Date() },
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
