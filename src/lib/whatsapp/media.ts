import "server-only";
import { prisma } from "@/lib/prisma";
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
 * Fetch a message's decrypted media from Evolution, store the bytes in object
 * storage and flip the row to READY. Idempotent (skips already-READY rows) and
 * self-contained so QStash can safely retry. Marks FAILED only when the provider
 * can't return the media, so the UI can stop showing a spinner.
 */
export async function runWhatsappMediaJob(job: WhatsappMediaJob): Promise<void> {
  const { messageId, organizationId, connectionId, key } = job;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { mediaStatus: true },
  });
  if (!message || message.mediaStatus === "READY") return;

  const creds = await loadEvoCredsById(connectionId);
  if (!creds) {
    await markFailed(messageId);
    return;
  }

  const media = await getBase64FromMediaMessage(creds, key);
  if (!media) {
    await markFailed(messageId);
    return;
  }

  const raw = media.base64.includes(",") ? media.base64.split(",").pop()! : media.base64;
  const buffer = Buffer.from(raw, "base64");
  const { url, size } = await putMedia(
    `whatsapp/${organizationId}/${messageId}.${extFor(media.mimetype)}`,
    buffer,
    media.mimetype,
  );

  await prisma.message.update({
    where: { id: messageId },
    data: { mediaUrl: url, mediaMime: media.mimetype, mediaSize: size, mediaStatus: "READY" },
  });
}

async function markFailed(messageId: string): Promise<void> {
  await prisma.message
    .update({ where: { id: messageId }, data: { mediaStatus: "FAILED" } })
    .catch(() => {});
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
