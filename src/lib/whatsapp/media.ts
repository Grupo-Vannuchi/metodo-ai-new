import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import { loadEvoCredsById } from "@/lib/integrations/evolution-creds";
import { getBase64FromMediaMessage, type EvoMediaKey } from "@/lib/integrations/evolution-client";
import { putMedia, deleteMedia } from "@/lib/storage/blob";

/** Payload for the `whatsapp-media` background job. */
export type WhatsappMediaJob = {
  messageId: string;
  organizationId: string;
  connectionId: string;
  key: EvoMediaKey;
};

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

/** File extension for a mimetype (ignores codec params like "; codecs=opus"). */
function extFor(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  return EXT[base] ?? base.split("/")[1] ?? "bin";
}

/**
 * Fetch a message's decrypted media from Evolution, store the bytes and flip the
 * row to READY. Idempotent (skips already-READY rows). Crucially it ALWAYS
 * resolves the row — any error (no creds, provider failure, timeout, bad bytes)
 * marks it FAILED so the UI never spins forever.
 */
export async function runWhatsappMediaJob(job: WhatsappMediaJob): Promise<void> {
  const { messageId, organizationId, connectionId, key } = job;
  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { mediaStatus: true },
    });
    if (!message || message.mediaStatus === "READY") return;

    const creds = await loadEvoCredsById(connectionId);
    if (!creds) {
      console.warn(`[media:${messageId}] no Evolution credentials`);
      return markFailed(messageId);
    }

    const media = await getBase64FromMediaMessage(creds, key);
    if (!media) {
      console.warn(`[media:${messageId}] Evolution returned no media`);
      return markFailed(messageId);
    }

    const raw = media.base64.includes(",") ? media.base64.split(",").pop()! : media.base64;
    const buffer = Buffer.from(raw, "base64");
    if (buffer.byteLength === 0) {
      console.warn(`[media:${messageId}] empty media buffer`);
      return markFailed(messageId);
    }

    const { url, size } = await putMedia(
      `whatsapp/${organizationId}/${messageId}.${extFor(media.mimetype)}`,
      buffer,
      media.mimetype,
    );
    await prisma.message.update({
      where: { id: messageId },
      data: { mediaUrl: url, mediaMime: media.mimetype, mediaSize: size, mediaStatus: "READY" },
    });
    console.log(`[media:${messageId}] stored ${size}B (${media.mimetype})`);
  } catch (error) {
    console.error(`[media:${messageId}] failed`, error);
    await markFailed(messageId);
  }
}

async function markFailed(messageId: string): Promise<void> {
  await prisma.message
    .update({ where: { id: messageId }, data: { mediaStatus: "FAILED" } })
    .catch(() => {});
}

/** Media columns the inbox UI needs back after an on-demand fetch. */
const MEDIA_FIELDS = {
  mediaUrl: true,
  mediaMime: true,
  mediaStatus: true,
  mediaSize: true,
  mediaDurationSec: true,
  mediaWidth: true,
  mediaHeight: true,
} satisfies Prisma.MessageSelect;

export type MediaResult = Prisma.MessageGetPayload<{ select: typeof MEDIA_FIELDS }>;

/**
 * On-demand media fetch for a single message, triggered by the inbox when a
 * PENDING media bubble is rendered (lazy — we only fetch media the user
 * actually opens). Org-scoped (ownership) and idempotent; returns the current
 * media columns so the client can swap the placeholder for the real thing.
 */
export async function processMessageMedia(
  organizationId: string,
  messageId: string,
): Promise<MediaResult | null> {
  const db = tenantDb(organizationId);
  const msg = await db.message.findFirst({
    where: { id: messageId },
    select: {
      mediaStatus: true,
      providerMessageId: true,
      fromMe: true,
      conversation: { select: { connectionId: true, remoteJid: true } },
    },
  });
  if (!msg) return null;

  if (msg.mediaStatus !== "READY") {
    if (!msg.providerMessageId || !msg.conversation) {
      await markFailed(messageId);
    } else {
      await runWhatsappMediaJob({
        messageId,
        organizationId,
        connectionId: msg.conversation.connectionId,
        key: { id: msg.providerMessageId, remoteJid: msg.conversation.remoteJid, fromMe: msg.fromMe },
      });
    }
  }

  return db.message.findFirst({ where: { id: messageId }, select: MEDIA_FIELDS });
}

/**
 * LGPD: delete the stored blobs of conversations about to be removed. Run before
 * the rows cascade away (best-effort, org-scoped — never touches other tenants).
 */
export async function purgeConversationMedia(
  organizationId: string,
  conversationIds: string[],
): Promise<void> {
  if (conversationIds.length === 0) return;
  const rows = await prisma.message.findMany({
    where: { organizationId, conversationId: { in: conversationIds }, mediaUrl: { not: null } },
    select: { mediaUrl: true },
  });
  await Promise.all(rows.map((r) => deleteMedia(r.mediaUrl!)));
}
