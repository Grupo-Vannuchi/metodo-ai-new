import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { putMedia } from "@/lib/storage/blob";
import { decryptCredentials } from "@/lib/integrations/crypto";
import { resolveEvoCreds } from "@/lib/integrations/evolution-creds";
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
 * Every refusal leaves a line in the hPanel log (the code and a technical note,
 * never the phone, the caption or the file name): before 17/11/2026 a refused
 * send left no trace, and a failure could not be told apart afterwards.
 */
function refuse(error: string, status: number, note: string): Response {
  console.warn(`[inbox] send media refused: ${error} (${note})`);
  return Response.json({ ok: false, error }, { status });
}

/**
 * Send a media message (image/video/audio/document) on WhatsApp. Uploads the
 * file to object storage, sends the URL through Evolution, and stores the
 * outbound Message (bytes never touch Postgres). Strictly per-user: only works
 * on a conversation from a number the caller connected.
 *
 * `uncertain` means the file may have gone out (Evolution did not answer, or the
 * send went out and saving it failed): the screen says so instead of offering a
 * retry that could deliver it twice.
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
  if (!file || !conversationId) return refuse("invalid", 400, file ? "no conversation" : "no file in the form");
  if (file.size > MAX_SIZE) return refuse("size", 400, `${file.size}B`);
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) return refuse("type", 400, mime);

  const db = tenantDb(ctx.organizationId);
  const convo = await db.conversation.findFirst({
    where: { id: conversationId },
    select: { id: true, connectionId: true, remoteJid: true, isGroup: true },
  });
  if (!convo) return refuse("not_found", 404, "no such conversation");

  // Per-user: the conversation must be on a number the caller connected.
  const owned = await db.integrationConnection.findFirst({
    where: { id: convo.connectionId, ownerId: ctx.userId },
    select: { id: true },
  });
  if (!owned) return refuse("not_found", 404, "the number is not the caller's");

  const conn = await db.integrationConnection.findFirst({
    where: { id: convo.connectionId, provider: "EVOLUTION" },
    select: { credentialsEnc: true },
  });
  if (!conn) return refuse("no_connection", 400, "not an Evolution connection");

  let creds: ReturnType<typeof resolveEvoCreds>;
  try {
    creds = resolveEvoCreds(decryptCredentials(conn.credentialsEnc));
  } catch {
    return refuse("no_connection", 400, "credentials unreadable");
  }
  if (!creds) return refuse("no_connection", 400, "credentials incomplete");

  const { mediatype, msgType } = classify(mime);
  const safeName = (file.name || "arquivo").replace(/[^\w.\-]+/g, "_").slice(0, 120) || "arquivo";

  let sent = false;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await putMedia(`inbox/${convo.connectionId}/out/${randomUUID()}-${safeName}`, buffer, mime);

    const adapter = getChannelAdapter("WHATSAPP_EVOLUTION");
    if (!adapter.sendMedia) return refuse("no_connection", 400, "adapter without sendMedia");
    const to = convo.isGroup ? convo.remoteJid : (convo.remoteJid.split("@")[0] ?? "");
    const result = await adapter.sendMedia(creds, {
      to,
      mediatype,
      media: stored.url,
      mimetype: mime,
      caption,
      fileName: file.name || safeName,
    });
    if (!result.ok) {
      const error = result.uncertain ? "uncertain" : "send_failed";
      console.error(`[inbox] send media ${error} (${mime}, ${stored.size}B): ${result.error ?? "no detail"}`);
      return Response.json({ ok: false, error, detail: result.error?.slice(0, 300) }, { status: 502 });
    }
    sent = true;

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
    // After `sent`, the file already went out: only saving it here failed.
    console.error(`[inbox] send media failed ${sent ? "after the file went out" : "before sending"}`, error);
    return Response.json({ ok: false, error: sent ? "uncertain" : "send_failed" }, { status: 500 });
  }
}
