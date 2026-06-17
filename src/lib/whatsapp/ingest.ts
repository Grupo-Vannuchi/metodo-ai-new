import "server-only";
import type { MessageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ParsedInbound } from "@/lib/whatsapp/inbound";

/**
 * Persist an inbound (or own-phone outbound) WhatsApp message: upsert the
 * conversation and append the message. Idempotent by providerMessageId so
 * webhook retries don't duplicate. Runs as system — the org is the boundary,
 * resolved from the connection in the webhook route.
 */
export async function ingestInbound(
  organizationId: string,
  connectionId: string,
  m: ParsedInbound,
): Promise<void> {
  if (m.providerMessageId) {
    const existing = await prisma.message.findFirst({
      where: { providerMessageId: m.providerMessageId },
      select: { id: true },
    });
    if (existing) return;
  }

  const conversation = await prisma.conversation.upsert({
    where: { connectionId_remoteJid: { connectionId, remoteJid: m.remoteJid } },
    create: {
      organizationId,
      connectionId,
      remoteJid: m.remoteJid,
      name: m.pushName,
      lastMessageAt: m.timestamp,
      lastMessagePreview: m.preview,
      unreadCount: m.fromMe ? 0 : 1,
    },
    update: {
      lastMessageAt: m.timestamp,
      lastMessagePreview: m.preview,
      ...(m.pushName ? { name: m.pushName } : {}),
      ...(m.fromMe ? {} : { unreadCount: { increment: 1 } }),
    },
    select: { id: true },
  });

  await prisma.message.create({
    data: {
      organizationId,
      conversationId: conversation.id,
      direction: m.fromMe ? "OUTBOUND" : "INBOUND",
      type: m.type as MessageType,
      body: m.body,
      providerMessageId: m.providerMessageId,
      fromMe: m.fromMe,
      status: m.fromMe ? "SENT" : null,
      timestamp: m.timestamp,
    },
  });
}
