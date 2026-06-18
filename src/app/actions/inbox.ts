"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { decryptCredentials } from "@/lib/integrations/crypto";
import { getChannelAdapter } from "@/lib/integrations/channels";
import { normalizeWhatsappNumber } from "@/lib/phone";

/** Reset a conversation's unread counter (called when it's opened). */
export async function markConversationRead(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    await db.conversation.updateMany({ where: { id }, data: { unreadCount: 0 } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to mark conversation read", error);
    return { ok: false };
  }
}

export type SendResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "empty" | "not_found" | "no_connection" | "send_failed" };

const MAX_LEN = 4096;

/** Send a text message in a conversation via the Evolution connection it flows
 * through, and persist it as an outbound message. */
export async function sendMessage(conversationId: string, text: string): Promise<SendResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const body = text.trim();
  if (!body) return { ok: false, error: "empty" };

  try {
    const db = tenantDb(ctx.organizationId);
    const convo = await db.conversation.findFirst({
      where: { id: conversationId },
      select: { id: true, connectionId: true, remoteJid: true },
    });
    if (!convo) return { ok: false, error: "not_found" };

    const conn = await db.integrationConnection.findFirst({
      where: { id: convo.connectionId, provider: "EVOLUTION" },
      select: { credentialsEnc: true },
    });
    if (!conn) return { ok: false, error: "no_connection" };

    let creds: Record<string, string>;
    try {
      creds = decryptCredentials(conn.credentialsEnc);
    } catch {
      return { ok: false, error: "no_connection" };
    }

    const to = convo.remoteJid.split("@")[0] ?? "";
    const adapter = getChannelAdapter("WHATSAPP_EVOLUTION");
    const result = await adapter.send(creds, { to, body: body.slice(0, MAX_LEN) });
    if (!result.ok) return { ok: false, error: "send_failed" };

    await db.message.create({
      data: {
        organizationId: ctx.organizationId,
        conversationId: convo.id,
        direction: "OUTBOUND",
        type: "TEXT",
        body,
        providerMessageId: result.providerMessageId ?? null,
        status: "SENT",
        fromMe: true,
        timestamp: new Date(),
      },
    });
    await db.conversation.updateMany({
      where: { id: convo.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: body },
    });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to send message", error);
    return { ok: false, error: "send_failed" };
  }
}

export type StartChatResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: "unauthorized" | "invalid" | "no_connection" | "unknown" };

/** Open (or create) a conversation for a phone number — used by the "Chat on
 * WhatsApp" button on a contact/company. */
export async function startConversation(input: {
  phone: string;
  name?: string;
  contactId?: string;
}): Promise<StartChatResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const digits = normalizeWhatsappNumber(input.phone);
  if (digits.length < 11) return { ok: false, error: "invalid" };
  const remoteJid = `${digits}@s.whatsapp.net`;

  try {
    const db = tenantDb(ctx.organizationId);
    const conn = await db.integrationConnection.findFirst({
      where: { provider: "EVOLUTION" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!conn) return { ok: false, error: "no_connection" };

    const convo = await db.conversation.upsert({
      where: { connectionId_remoteJid: { connectionId: conn.id, remoteJid } },
      create: {
        organizationId: ctx.organizationId,
        connectionId: conn.id,
        remoteJid,
        name: input.name ?? null,
        contactId: input.contactId ?? null,
      },
      update: input.contactId ? { contactId: input.contactId } : {},
      select: { id: true },
    });
    revalidatePath("/app/inbox");
    return { ok: true, conversationId: convo.id };
  } catch (error) {
    console.error("Failed to start conversation", error);
    return { ok: false, error: "unknown" };
  }
}
