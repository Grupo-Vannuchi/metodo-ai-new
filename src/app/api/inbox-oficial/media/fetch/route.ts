import { cloudGuard, guardResponse } from "@/lib/whatsapp-cloud/guard";
import { getCloudMessageMedia, getOwnedCloudMessage } from "@/lib/queries/inbox-oficial";
import { downloadInboundMedia } from "@/lib/whatsapp-cloud/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download sob demanda de uma mídia recebida (quando a tela exibe uma mídia pendente). */
export async function POST(req: Request) {
  const g = await cloudGuard();
  if (!g.ok) return guardResponse(g.error);
  let messageId = "";
  try {
    messageId = String(((await req.json()) as { messageId?: string })?.messageId ?? "");
  } catch {
    /* corpo inválido */
  }
  if (!messageId) return new Response("Bad request", { status: 400 });
  const msg = await getOwnedCloudMessage(g.ctx.organizationId, g.ctx.userId, messageId);
  if (!msg) return new Response("Forbidden", { status: 403 });
  await downloadInboundMedia(g.ctx.organizationId, messageId);
  return Response.json(await getCloudMessageMedia(g.ctx.organizationId, messageId));
}
