import "server-only";
import type { MessageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatBrPhone, brPhoneKey } from "@/lib/phone";
import type { ParsedInbound } from "@/lib/whatsapp/inbound";

/**
 * Persist an inbound (or own-phone outbound) WhatsApp message: link the
 * conversation to a CRM contact, upsert it and append the message. Idempotent
 * by providerMessageId so webhook retries don't duplicate. Runs as system — the
 * org is the boundary, resolved from the connection in the webhook route.
 */

/** Find the org contact matching this number, creating one if none exists. */
async function resolveContactId(
  organizationId: string,
  remoteJid: string,
  pushName: string | null,
): Promise<string | null> {
  const digits = remoteJid.split("@")[0] ?? "";
  const key = brPhoneKey(digits);
  if (!key) return null;

  // Match by the local phone digits regardless of stored formatting.
  const found = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM contacts
    WHERE "organizationId" = ${organizationId}
      AND phone IS NOT NULL
      AND right(regexp_replace(phone, '\D', '', 'g'), 11) = ${key}
    LIMIT 1`;
  if (found[0]) return found[0].id;

  const phone = formatBrPhone(digits);
  const contact = await prisma.contact.create({
    data: {
      organizationId,
      name: pushName || phone || digits,
      phone: phone || null,
      tags: ["whatsapp"],
      source: "whatsapp",
    },
    select: { id: true },
  });
  return contact.id;
}

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

  let conversation = await prisma.conversation.findUnique({
    where: { connectionId_remoteJid: { connectionId, remoteJid: m.remoteJid } },
    select: { id: true },
  });

  if (!conversation) {
    const contactId = await resolveContactId(organizationId, m.remoteJid, m.pushName);
    conversation = await prisma.conversation.create({
      data: {
        organizationId,
        connectionId,
        remoteJid: m.remoteJid,
        name: m.pushName,
        contactId,
        lastMessageAt: m.timestamp,
        lastMessagePreview: m.preview,
        unreadCount: m.fromMe ? 0 : 1,
      },
      select: { id: true },
    });
  } else {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: m.timestamp,
        lastMessagePreview: m.preview,
        ...(m.pushName ? { name: m.pushName } : {}),
        ...(m.fromMe ? {} : { unreadCount: { increment: 1 } }),
      },
    });
  }

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
