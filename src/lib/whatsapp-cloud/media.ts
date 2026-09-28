import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { putMedia } from "@/lib/storage/blob";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import { getMediaInfo } from "@/lib/whatsapp-cloud/meta-api";
import { graphDownload } from "@/lib/whatsapp-cloud/graph";
import { loadNumber } from "@/lib/whatsapp-cloud/numbers";
import { extensionFor } from "@/lib/whatsapp-cloud/media-rules";

/** Payload do job `whatsapp-cloud-media`. */
export type WhatsappCloudMediaJob = { organizationId: string; messageId: string };

/** O id de mídia recebida vale 7 dias na Meta. */
const MEDIA_ID_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Baixa a mídia de uma mensagem recebida (Meta → armazenamento) e marca READY.
 * Idempotente; qualquer falha marca FAILED para a tela nunca girar para sempre.
 */
export async function downloadInboundMedia(organizationId: string, messageId: string): Promise<void> {
  const db = tenantDb(organizationId);
  const msg = await db.whatsappCloudMessage.findFirst({
    where: { id: messageId },
    select: {
      mediaId: true,
      mediaStatus: true,
      mediaMime: true,
      timestamp: true,
      conversation: { select: { numberId: true } },
    },
  });
  if (!msg || msg.mediaStatus === "READY" || !msg.mediaId) return;
  const fail = async () => {
    await db.whatsappCloudMessage.updateMany({ where: { id: messageId }, data: { mediaStatus: "FAILED" } });
  };
  if (Date.now() - msg.timestamp.getTime() > MEDIA_ID_TTL_MS) return fail();
  try {
    const number = await loadNumber(organizationId, msg.conversation.numberId);
    if (!number) return fail();
    const info = await getMediaInfo(msg.mediaId, number.token);
    if (!info.ok || !info.data.url) {
      console.warn(`[wa-cloud] media ${messageId}: ${info.ok ? "sem url" : info.message}`);
      return fail();
    }
    const file = await graphDownload(info.data.url, number.token);
    if (!file.ok || file.bytes.byteLength === 0) return fail();
    const mime = (info.data.mime_type ?? file.mime ?? msg.mediaMime ?? "application/octet-stream").split(";")[0].trim();
    const stored = await putMedia(`whatsapp/${organizationId}/cloud/${messageId}.${extensionFor(mime)}`, file.bytes, mime);
    await db.whatsappCloudMessage.updateMany({
      where: { id: messageId },
      data: { mediaUrl: stored.url, mediaMime: mime, mediaSize: stored.size, mediaStatus: "READY" },
    });
  } catch (error) {
    console.error(`[wa-cloud] media ${messageId} failed`, error);
    await fail();
  }
}

/**
 * Dispara o download fora do caminho do webhook: job do QStash quando existe,
 * senão em processo depois da resposta (o Node do Passenger é persistente — mesmo
 * padrão do agente de IA). A tela ainda tenta sob demanda (media/fetch).
 */
export function scheduleMediaDownload(organizationId: string, messageId: string): void {
  const run = () =>
    void downloadInboundMedia(organizationId, messageId).catch((e) =>
      console.error("[wa-cloud] media download failed", e),
    );
  if (!isQueueConfigured()) return run();
  const job: WhatsappCloudMediaJob = { organizationId, messageId };
  void enqueue("whatsapp-cloud-media", job, { deduplicationId: `wa-cloud-media-${messageId}` }).catch((e) => {
    console.error("[wa-cloud] enqueue media failed", e);
    run();
  });
}
