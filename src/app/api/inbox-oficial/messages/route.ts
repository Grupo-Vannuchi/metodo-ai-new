import { cloudGuard, guardResponse } from "@/lib/whatsapp-cloud/guard";
import { listCloudMessages } from "@/lib/queries/inbox-oficial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mensagens da conversa aberta (polling). Conversa de outro vendedor → []. */
export async function GET(req: Request) {
  const g = await cloudGuard();
  if (!g.ok) return guardResponse(g.error);
  const id = new URL(req.url).searchParams.get("conversationId");
  if (!id) return Response.json([]);
  return Response.json(await listCloudMessages(g.ctx.organizationId, g.ctx.userId, id));
}
