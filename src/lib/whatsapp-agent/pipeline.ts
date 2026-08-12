import "server-only";
import { prisma } from "@/lib/prisma";
import { getAnthropic } from "@/lib/assistant/client";
import { loadEvoCredsById } from "@/lib/integrations/evolution-creds";
import { getChannelAdapter } from "@/lib/integrations/channels";
import { hasFeature, type PlanKey } from "@/config/plans";
import type { ParsedInbound } from "@/lib/whatsapp/inbound";

/** Wait this long before replying, so rapid-fire messages get answered as one. */
const DEBOUNCE_MS = 8000;
/** How many recent messages of the chat to feed the model as context (memory). */
const HISTORY_LIMIT = 20;
const MAX_TOKENS = 800;

type Turn = { role: "user" | "assistant"; content: string };

/**
 * Fire-and-forget the WhatsApp AI auto-reply for an inbound message. The webhook
 * must return fast, so this is intentionally NOT awaited; it runs on the
 * persistent Node server (Hostinger/Passenger), where the promise completes
 * after the response is sent. Only customer text messages trigger the agent.
 */
export function scheduleAgentReply(organizationId: string, connectionId: string, m: ParsedInbound): void {
  if (m.fromMe || m.isGroup) return;
  if (!(m.body ?? "").trim()) return;
  void runAgentReply(organizationId, connectionId, m).catch((e) =>
    console.error("[whatsapp-agent] reply failed", e),
  );
}

async function runAgentReply(organizationId: string, connectionId: string, m: ParsedInbound): Promise<void> {
  // 1. Agent enabled + configured for this connection?
  const agent = await prisma.whatsappAgent.findFirst({
    where: { organizationId, connectionId, enabled: true },
    select: { prompt: true, model: true },
  });
  if (!agent || !agent.prompt.trim()) return;

  // 2. Plan still entitles the feature (a downgrade silences the bot)?
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true } });
  if (!org || !hasFeature(org.plan as PlanKey, "whatsapp_agent")) return;

  // 3. Debounce — batch a burst of messages into one reply.
  await sleep(DEBOUNCE_MS);

  const conversation = await prisma.conversation.findUnique({
    where: { connectionId_remoteJid: { connectionId, remoteJid: m.remoteJid } },
    select: { id: true, assignedToId: true },
  });
  if (!conversation) return;

  // 4. Human handoff — a team member owns this chat → the bot stays silent.
  if (conversation.assignedToId) return;

  // 5. Our message must still be the very latest in the chat: no newer inbound
  //    (a later message's own job handles the burst) and nobody has replied yet
  //    (bot or human). This debounces AND prevents double replies.
  const latest = await prisma.message.findFirst({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    select: { direction: true, providerMessageId: true },
  });
  if (!latest || latest.direction !== "INBOUND") return;
  if (m.providerMessageId && latest.providerMessageId !== m.providerMessageId) return;

  // 6. Build the conversation memory (chat history) for the model.
  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id, body: { not: null } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { direction: true, body: true },
  });
  const messages = toAlternatingTurns(
    history
      .reverse()
      .map((h): Turn => ({ role: h.direction === "INBOUND" ? "user" : "assistant", content: (h.body ?? "").trim() }))
      .filter((t) => t.content),
  );
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return;

  // 7. Ask the model.
  const anthropic = getAnthropic();
  if (!anthropic) return;
  const res = await anthropic.messages.create({
    model: agent.model,
    max_tokens: MAX_TOKENS,
    system: agent.prompt,
    messages,
  });
  const text = res.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("\n")
    .trim();
  if (!text) return;

  // 8. Send the reply on the SAME connection the message came in on.
  const creds = await loadEvoCredsById(connectionId);
  if (!creds) return;
  const number = m.remoteJid.split("@")[0];
  await getChannelAdapter("WHATSAPP_EVOLUTION").send(creds, { to: number, body: text });
}

/** Merge consecutive same-role turns and drop any leading assistant turns, so
 *  the sequence alternates and starts with the user (Anthropic requirement). */
function toAlternatingTurns(turns: Turn[]): Turn[] {
  const merged: Turn[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.content += "\n" + t.content;
    else merged.push({ ...t });
  }
  while (merged.length && merged[0].role === "assistant") merged.shift();
  return merged;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
