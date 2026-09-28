import { randomUUID } from "crypto";
import type { WhatsappCloudMessageType } from "@prisma/client";
import { deleteMedia, putMedia } from "@/lib/storage/blob";
import { cloudGuard, guardResponse } from "@/lib/whatsapp-cloud/guard";
import { getOwnedCloudConversation } from "@/lib/queries/inbox-oficial";
import { loadNumber } from "@/lib/whatsapp-cloud/numbers";
import { isWindowOpen } from "@/lib/whatsapp-cloud/window";
import { checkOutboundMedia, MAX_UPLOAD_BYTES, sniffMime, type OutboundKind } from "@/lib/whatsapp-cloud/media-rules";
import { uploadMedia } from "@/lib/whatsapp-cloud/meta-api";
import { categorizeMetaError } from "@/lib/whatsapp-cloud/errors";
import { mediaPayload } from "@/lib/whatsapp-cloud/payloads";
import { callSend, recordOutbound } from "@/lib/whatsapp-cloud/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPE_FOR: Record<OutboundKind, WhatsappCloudMessageType> = {
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  document: "DOCUMENT",
};

const fail = (status: number, error: string, detail?: string) =>
  Response.json({ ok: false, error, ...(detail ? { detail } : {}) }, { status });

/**
 * Envia um anexo na conversa oficial. Confere o tipo pelo CONTEÚDO (não pela
 * extensão) e o tamanho pela tabela da Meta; guarda uma cópia para exibir, sobe
 * para a Meta e envia por id. Só no número do próprio usuário e com a janela aberta.
 */
export async function POST(req: Request) {
  const g = await cloudGuard();
  if (!g.ok) return guardResponse(g.error);
  const { ctx } = g;

  let file: File | null = null;
  let conversationId = "";
  let caption = "";
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    conversationId = String(form.get("conversationId") ?? "");
    caption = String(form.get("caption") ?? "").trim().slice(0, 1024);
  } catch {
    /* corpo inválido */
  }
  if (!file || !conversationId) return fail(400, "invalid");
  if (file.size > MAX_UPLOAD_BYTES) return fail(400, "too_large");

  const convo = await getOwnedCloudConversation(ctx.organizationId, ctx.userId, conversationId);
  if (!convo) return fail(404, "not_found");
  if (!isWindowOpen(convo.lastInboundAt)) return fail(400, "window_closed");
  const number = await loadNumber(ctx.organizationId, convo.numberId);
  if (!number || number.status !== "ACTIVE") return fail(400, "no_number");

  const bytes = Buffer.from(await file.arrayBuffer());
  const check = checkOutboundMedia(sniffMime(bytes, file.type), bytes.byteLength);
  if (!check.ok) return fail(400, check.reason);

  const displayName = (file.name || "arquivo").slice(0, 200);
  const safeName = displayName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "arquivo";
  let storedUrl: string | null = null;
  try {
    const stored = await putMedia(
      `whatsapp/${ctx.organizationId}/cloud/out/${randomUUID()}-${safeName}`,
      bytes,
      check.mime,
    );
    storedUrl = stored.url;
    const up = await uploadMedia(number.phoneNumberId, number.token, bytes, check.mime, safeName);
    if (!up.ok || !up.data.id) {
      await deleteMedia(stored.url);
      return fail(502, up.ok ? "unknown" : categorizeMetaError(up.code), up.ok ? undefined : up.message);
    }
    const res = await callSend(
      number,
      mediaPayload(convo, check.kind, up.data.id, { caption: caption || null, filename: displayName }),
    );
    if (!res.ok) {
      await deleteMedia(stored.url);
      return fail(502, res.category, res.message);
    }
    // A Meta já aceitou: a partir daqui a mídia enviada não pode mais ser apagada,
    // e uma falha ao gravar não pode virar erro pro vendedor (ele reenviaria e
    // duplicaria a mensagem pro cliente).
    try {
      await recordOutbound(ctx.organizationId, {
        conversationId,
        wamid: res.wamid,
        type: TYPE_FOR[check.kind],
        body: caption || null,
        media: { url: stored.url, mime: check.mime, name: displayName, size: stored.size },
        sentById: ctx.userId,
      });
    } catch (error) {
      console.error("[wa-cloud] sent but not recorded", { wamid: res.wamid, conversationId }, error);
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (storedUrl) await deleteMedia(storedUrl);
    console.error("[wa-cloud] upload failed", error);
    return fail(500, "unknown");
  }
}
