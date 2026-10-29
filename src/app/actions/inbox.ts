"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { decryptCredentials } from "@/lib/integrations/crypto";
import { resolveEvoCreds } from "@/lib/integrations/evolution-creds";
import { getChannelAdapter } from "@/lib/integrations/channels";
import type { SendInput } from "@/lib/integrations/channels/types";
import { normalizeWhatsappNumber, formatBrPhone, brPhoneKey, looksLikeWhatsappMobile } from "@/lib/phone";
import { onlyDigits } from "@/lib/cnpj";
import { getContactRows, getGroupMembers } from "@/lib/whatsapp/export";
import { ensureContactFolder, findContactFolder, whatsappFolderName } from "@/lib/crm/import-folders";
import { createWhatsappContacts, type WhatsappContactRow } from "@/lib/crm/whatsapp-import-contacts";
import {
  CONTACT_NAME_PREFIX,
  MAX_IMPORT_GROUPS,
  lastContactNumber,
  planGroupImport,
} from "@/lib/whatsapp/group-import";
import { purgeConversationMedia } from "@/lib/whatsapp/media";
import { applyReaction, myReaction } from "@/lib/whatsapp/reactions";

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
  | {
      ok: false;
      error: "unauthorized" | "empty" | "not_found" | "no_connection" | "send_failed";
      /** The underlying reason (Evolution message or exception), for troubleshooting. */
      detail?: string;
    };

const MAX_LEN = 4096;

/** Short label for a non-text message when quoted in a reply. */
const QUOTED_LABEL: Record<string, string> = {
  IMAGE: "📷 Imagem",
  VIDEO: "🎬 Vídeo",
  AUDIO: "🎧 Áudio",
  DOCUMENT: "📄 Documento",
  STICKER: "Figurinha",
  LOCATION: "📍 Localização",
};

/** Send a text message in a conversation via the Evolution connection it flows
 * through, and persist it as an outbound message. `replyToMessageId` quotes an
 * existing message (WhatsApp reply). */
export async function sendMessage(
  conversationId: string,
  text: string,
  replyToMessageId?: string,
): Promise<SendResult> {
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

    // A user can only send in conversations from their OWN connected number —
    // WhatsApp is strictly per-user (admins included), never shared.
    const owned = await db.integrationConnection.findFirst({
      where: { id: convo.connectionId, ownerId: ctx.userId },
      select: { id: true },
    });
    if (!owned) return { ok: false, error: "not_found" };

    const conn = await db.integrationConnection.findFirst({
      where: { id: convo.connectionId, provider: "EVOLUTION" },
      select: { credentialsEnc: true },
    });
    if (!conn) return { ok: false, error: "no_connection" };

    // Resolve the effective creds: platform connections store only the instance;
    // baseUrl + apiKey come from the shared env (resolveEvoCreds fills them in).
    let creds: ReturnType<typeof resolveEvoCreds>;
    try {
      creds = resolveEvoCreds(decryptCredentials(conn.credentialsEnc));
    } catch {
      return { ok: false, error: "no_connection" };
    }
    if (!creds) return { ok: false, error: "no_connection", detail: "Credenciais do Evolution incompletas (verifique EVOLUTION_API_URL/EVOLUTION_API_KEY)" };

    // Resolve the quoted message (must be in this conversation).
    let quoted: SendInput["quoted"];
    let quotedSnapshot = { quotedMessageId: null as string | null, quotedBody: null as string | null, quotedSender: null as string | null };
    if (replyToMessageId) {
      const rep = await db.message.findFirst({
        where: { id: replyToMessageId, conversationId },
        select: { providerMessageId: true, body: true, fromMe: true, senderName: true, type: true },
      });
      if (rep) {
        const qBody = (rep.body?.trim() || QUOTED_LABEL[rep.type] || "[mensagem]").slice(0, 300);
        quotedSnapshot = {
          quotedMessageId: rep.providerMessageId,
          quotedBody: qBody,
          quotedSender: rep.fromMe ? null : (rep.senderName ?? null),
        };
        if (rep.providerMessageId) {
          quoted = { messageId: rep.providerMessageId, remoteJid: convo.remoteJid, fromMe: rep.fromMe, body: qBody };
        }
      }
    }

    // Groups send to the full JID; individuals to the bare number.
    const to = convo.isGroup ? convo.remoteJid : (convo.remoteJid.split("@")[0] ?? "");
    const adapter = getChannelAdapter("WHATSAPP_EVOLUTION");
    const result = await adapter.send(creds, { to, body: body.slice(0, MAX_LEN), quoted });
    if (!result.ok) {
      console.error("[inbox] send_failed via Evolution:", result.error);
      return { ok: false, error: "send_failed", detail: result.error };
    }

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
        ...quotedSnapshot,
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
    return { ok: false, error: "send_failed", detail: error instanceof Error ? error.message : String(error) };
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
    // Start the chat on the user's OWN connected number (per-user WhatsApp) —
    // not whatever number happens to be the most recent in the org.
    const conn = await db.integrationConnection.findFirst({
      where: { provider: "EVOLUTION", ownerId: ctx.userId },
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

/** React to a message with an emoji (toggles off if it's already your reaction).
 * Sends to WhatsApp via Evolution and mirrors it locally. Per-user scoped. */
export async function reactToMessage(messageId: string, emoji: string): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    const msg = await db.message.findFirst({
      where: { id: messageId },
      select: { id: true, conversationId: true, providerMessageId: true, fromMe: true, reactions: true },
    });
    if (!msg) return { ok: false };
    const convo = await db.conversation.findFirst({
      where: { id: msg.conversationId },
      select: { remoteJid: true, connectionId: true },
    });
    if (!convo) return { ok: false };
    // Per-user: only on a number the caller connected.
    const conn = await db.integrationConnection.findFirst({
      where: { id: convo.connectionId, ownerId: ctx.userId, provider: "EVOLUTION" },
      select: { credentialsEnc: true },
    });
    if (!conn) return { ok: false };

    // Toggle: reacting with the same emoji removes it.
    const finalEmoji = myReaction(msg.reactions) === emoji ? "" : emoji;

    if (msg.providerMessageId) {
      try {
        const creds = resolveEvoCreds(decryptCredentials(conn.credentialsEnc));
        if (creds) {
          const adapter = getChannelAdapter("WHATSAPP_EVOLUTION");
          await adapter.sendReaction?.(creds, {
            remoteJid: convo.remoteJid,
            fromMe: msg.fromMe,
            messageId: msg.providerMessageId,
            emoji: finalEmoji,
          });
        }
      } catch {
        /* still mirror locally even if the send fails */
      }
    }

    const reactions = applyReaction(msg.reactions, { emoji: finalEmoji, fromMe: true });
    await db.message.updateMany({ where: { id: messageId }, data: { reactions } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to react to message", error);
    return { ok: false };
  }
}

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

export type ImportLine = {
  /** "contacts" or the group's conversation id. */
  id: string;
  label: string;
  created: number;
  skipped: number;
  /** The group couldn't be read (not one of the caller's groups, or Evolution didn't answer). */
  failed?: boolean;
};

export type ImportContactsResult =
  | { ok: true; lines: ImportLine[] }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

const importTargetSchema = z.object({
  contacts: z.boolean(),
  groupIds: z.array(z.string().min(1).max(64)).max(MAX_IMPORT_GROUPS),
});

type Db = ReturnType<typeof tenantDb>;

/** The caller's individual conversations, under their names, in a new dated folder. */
async function importConversationContacts(
  db: Db,
  organizationId: string,
  userId: string,
  known: Set<string>,
): Promise<ImportLine> {
  const rows = await getContactRows(organizationId, userId);
  const picked: WhatsappContactRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const digits = onlyDigits(r.number);
    const key = brPhoneKey(digits);
    // Skip non-WhatsApp-capable numbers (LIDs, landlines, malformed) so we
    // don't create junk CRM contacts that would fail on send.
    if (!key || known.has(key) || !looksLikeWhatsappMobile(normalizeWhatsappNumber(digits))) {
      skipped++;
      continue;
    }
    known.add(key);
    const phone = formatBrPhone(digits) || digits;
    picked.push({ name: r.name?.trim() || phone, phone });
  }
  // The folder is created only when something is filed: a run where everything
  // is a duplicate leaves no empty folder behind.
  if (picked.length > 0) {
    const folderId = await ensureContactFolder(db, organizationId, whatsappFolderName("Contatos", new Date()));
    await createWhatsappContacts(db, organizationId, picked, folderId);
  }
  return { id: "contacts", label: "Contatos", created: picked.length, skipped };
}

/** A group's members as "Contato #N" in the folder named after the group, numbered after the last one there. */
async function importGroup(
  db: Db,
  organizationId: string,
  userId: string,
  conversationId: string,
  known: Set<string>,
): Promise<ImportLine> {
  const group = await getGroupMembers(organizationId, conversationId, userId);
  if (!group || !group.readable) {
    return { id: conversationId, label: group?.title ?? "", created: 0, skipped: 0, failed: true };
  }

  const existingFolder = await findContactFolder(db, group.title);
  const numbered = existingFolder
    ? await db.contact.findMany({
        where: { folderLinks: { some: { folderId: existingFolder } }, name: { startsWith: CONTACT_NAME_PREFIX } },
        select: { name: true },
      })
    : [];
  const plan = planGroupImport(
    group.members.map((m) => m.number),
    known,
    lastContactNumber(numbered.map((c) => c.name)),
  );
  if (plan.create.length > 0) {
    const folderId = existingFolder ?? (await ensureContactFolder(db, organizationId, group.title));
    await createWhatsappContacts(db, organizationId, plan.create.map((c) => ({ name: c.name, phone: c.phone })), folderId);
    for (const c of plan.create) known.add(c.key);
  }
  return { id: conversationId, label: group.title, created: plan.create.length, skipped: plan.skipped };
}

/**
 * "Adicionar aos contatos": the caller's individual conversations and/or the
 * members of one or more of their groups become CRM contacts. Numbers already
 * in the CRM are skipped (compared by brPhoneKey), including ones added earlier
 * in the same run, so a member of two picked groups lands only in the first.
 */
export async function importWhatsappContactsToCrm(target: {
  contacts: boolean;
  groupIds: string[];
}): Promise<ImportContactsResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = importTargetSchema.safeParse(target);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const groupIds = [...new Set(parsed.data.groupIds)];

  try {
    const db = tenantDb(ctx.organizationId);
    const phones = await db.contact.findMany({ where: { phone: { not: null } }, select: { phone: true } });
    const known = new Set(phones.map((c) => brPhoneKey(c.phone ?? "")).filter(Boolean));

    const lines: ImportLine[] = [];
    if (parsed.data.contacts) {
      lines.push(await importConversationContacts(db, ctx.organizationId, ctx.userId, known));
    }
    for (const id of groupIds) {
      lines.push(await importGroup(db, ctx.organizationId, ctx.userId, id, known));
    }

    revalidatePath("/app/contacts");
    return { ok: true, lines };
  } catch (error) {
    console.error("Failed to import WhatsApp contacts to CRM", error);
    return { ok: false, error: "unknown" };
  }
}
