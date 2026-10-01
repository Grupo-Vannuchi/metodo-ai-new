import { cloudGuard, guardResponse } from "@/lib/whatsapp-cloud/guard";
import { listCloudConversations } from "@/lib/queries/inbox-oficial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lista da tela oficial (polling). Só o número do próprio usuário. */
export async function GET() {
  const g = await cloudGuard();
  if (!g.ok) return guardResponse(g.error);
  return Response.json(await listCloudConversations(g.ctx.organizationId, g.ctx.userId));
}
