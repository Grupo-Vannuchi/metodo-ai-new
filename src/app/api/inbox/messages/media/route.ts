import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { putMedia } from "@/lib/storage/blob";
import { decryptCredentials } from "@/lib/integrations/crypto";
import { getChannelAdapter } from "@/lib/integrations/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 16 * 1024 * 1024; // 16 MB (WhatsApp media ceiling)

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/webm",
  "audio/wav",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

type Mediatype = "image" | "video" | "document" | "audio";
type MsgType = "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";

function classify(mime: string): { mediatype: Mediatype; msgType: MsgType } {
  if (mime.startsWith("image/")) return { mediatype: "image", msgType: "IMAGE" };
  if (mime.startsWith("video/")) return { mediatype: "video", msgType: "VIDEO" };
  if (mime.startsWith("audio/")) return { mediatype: "audio", msgType: "AUDIO" };
  return { mediatype: "document", msgType: "DOCUMENT" };
}

const PREVIEW: Record<MsgType, string> = {
  IMAGE: "📷 Imagem",
  VIDEO: "🎬 Vídeo",
  AUDIO: "🎧 Áudio",
  DOCUMENT: "📄 Documento",
};

/**
 * Send a media message (image/video/audio/document) on WhatsApp. Uploads the
 * file to object storage, sends the URL through Evolution, and stores the
 * outbound Message (bytes never touch Postgres). Strictly per-user: only works
 * on a conversation from a number the caller connected.
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  let file: File | null = null;
  let conversationId = "";
  let caption = "";
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    conversationId = String(form.get("conversationId") ?? "");
    caption = String(form.get("caption") ?? "").slice(0, 1000);
  } catch {
    /* ignore */
  }
  if (!file || !conversationId) return Response.json({ ok: false, error: "invalid" }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ ok: false, error: "size" }, { status: 400 });
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) return Response.json({ ok: false, error: "type" }, { status: 400 });

  const db = tenantDb(ctx.organizationId);
  const convo = await db.conversation.findFirst({
    where: { id: conversationId },
    select: { id: true, connectionId: true, remoteJid: true, isGroup: true },
  });
  if (!convo) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  // Per-user: the conversation must be on a number the caller connected.
  const owned = await db.integrationConnection.findFirst({
    where: { id: convo.connectionId, ownerId: ctx.userId },
    select: { id: true },
  });
  if (!owned) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const conn = await db.integrationConnection.findFirst({
    where: { id: convo.connectionId, provider: "EVOLUTION" },
    select: { credentialsEnc: true },
  });
  if (!conn) return Response.json({ ok: false, error: "no_connection" }, { status: 400 });

  let creds: Record<string, string>;
  try {
    creds = decryptCredentials(conn.credentialsEnc);
  } catch {
    return Response.json({ ok: false, error: "no_connection" }, { status: 400 });
  }

  const { mediatype, msgType } = classify(mime);
  const safeName = (file.name || "arquivo").replace(/[^\w.\-]+/g, "_").slice(0, 120) || "arquivo";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await putMedia(`inbox/${convo.connectionId}/out/${randomUUID()}-${safeName}`, buffer, mime);

    const adapter = getChannelAdapter("WHATSAPP_EVOLUTION");
    if (!adapter.sendMedia) return Response.json({ ok: false, error: "no_connection" }, { status: 400 });
    const to = convo.isGroup ? convo.remoteJid : (convo.remoteJid.split("@")[0] ?? "");
    const result = await adapter.sendMedia(creds, {
      to,
      mediatype,
      media: stored.url,
      mimetype: mime,
      caption,
      fileName: file.name || safeName,
    });
    if (!result.ok) return Response.json({ ok: false, error: "send_failed" }, { status: 502 });

    await db.message.create({
      data: {
        organizationId: ctx.organizationId,
        conversationId: convo.id,
        direction: "OUTBOUND",
        type: msgType,
        body: caption || null,
        mediaUrl: stored.url,
        mediaMime: mime,
        mediaName: file.name || safeName,
        mediaSize: stored.size,
        mediaStatus: "READY",
        providerMessageId: result.providerMessageId ?? null,
        status: "SENT",
        fromMe: true,
        timestamp: new Date(),
      },
    });
    await db.conversation.updateMany({
      where: { id: convo.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: caption || PREVIEW[msgType] },
    });
    revalidatePath("/app/inbox");
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[inbox] send media failed", error);
    return Response.json({ ok: false, error: "send_failed" }, { status: 500 });
  }
}
