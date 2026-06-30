"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { decryptCredentials } from "@/lib/integrations/crypto";
import { getChannelAdapter } from "@/lib/integrations/channels";
import { normalizeWhatsappNumber } from "@/lib/phone";
import { purgeConversationMedia } from "@/lib/whatsapp/media";

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
      select: { id: true, connectionId: true, remoteJid: true, isGroup: true },
    });
    if (!convo) return { ok: false, error: "not_found" };

    // Members can only send in conversations from their own connected number.
    if (ctx.role === "MEMBER") {
      const owned = await db.integrationConnection.findFirst({
        where: { id: convo.connectionId, ownerId: ctx.userId },
        select: { id: true },
      });
      if (!owned) return { ok: false, error: "not_found" };
    }

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

    // Groups send to the full JID; individuals to the bare number.
    const to = convo.isGroup ? convo.remoteJid : (convo.remoteJid.split("@")[0] ?? "");
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

type Ok = { ok: boolean };

/** Pin / unpin a conversation (sorts to the top of its list). */
export async function pinConversation(id: string, pinned: boolean): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    await tenantDb(ctx.organizationId).conversation.updateMany({ where: { id }, data: { pinned } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to pin conversation", error);
    return { ok: false };
  }
}

/** Set a custom display name (empty string clears it, reverting to push name). */
export async function renameConversation(id: string, name: string | null): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  const customName = name && name.trim() ? name.trim().slice(0, 80) : null;
  try {
    await tenantDb(ctx.organizationId).conversation.updateMany({ where: { id }, data: { customName } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to rename conversation", error);
    return { ok: false };
  }
}

/** Permanently delete a conversation and its messages (FK cascade). */
export async function deleteConversation(id: string): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    // Only the org's own conversation; if it isn't, both calls are no-ops.
    const owned = await db.conversation.findFirst({ where: { id }, select: { id: true } });
    if (!owned) return { ok: false };
    // LGPD: drop stored media before the messages cascade away (best-effort).
    await purgeConversationMedia(ctx.organizationId, [id]).catch(() => {});
    await db.conversation.deleteMany({ where: { id } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete conversation", error);
    return { ok: false };
  }
}

/** Move a conversation into a folder (null = no folder). Validates ownership. */
export async function moveConversation(id: string, folderId: string | null): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  const db = tenantDb(ctx.organizationId);
  try {
    if (folderId) {
      const folder = await db.conversationFolder.findFirst({ where: { id: folderId }, select: { id: true } });
      if (!folder) return { ok: false };
    }
    await db.conversation.updateMany({ where: { id }, data: { folderId } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to move conversation", error);
    return { ok: false };
  }
}

type FolderResult = { ok: true; id?: string } | { ok: false };

/** Create an inbox folder. Returns its id. */
export async function createConversationFolder(name: string): Promise<FolderResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  const clean = name.trim().slice(0, 60);
  if (!clean) return { ok: false };
  try {
    const folder = await tenantDb(ctx.organizationId).conversationFolder.create({
      data: { organizationId: ctx.organizationId, name: clean },
      select: { id: true },
    });
    revalidatePath("/app/inbox");
    return { ok: true, id: folder.id };
  } catch (error) {
    console.error("Failed to create folder", error);
    return { ok: false };
  }
}

/** Rename an inbox folder. */
export async function renameConversationFolder(id: string, name: string): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  const clean = name.trim().slice(0, 60);
  if (!clean) return { ok: false };
  try {
    await tenantDb(ctx.organizationId).conversationFolder.updateMany({ where: { id }, data: { name: clean } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to rename folder", error);
    return { ok: false };
  }
}

/** Delete an inbox folder. Its conversations fall back to "no folder" (FK SetNull). */
export async function deleteConversationFolder(id: string): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    await tenantDb(ctx.organizationId).conversationFolder.deleteMany({ where: { id } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete folder", error);
    return { ok: false };
  }
}
