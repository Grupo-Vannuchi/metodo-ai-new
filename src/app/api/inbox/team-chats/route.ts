import { getOrgContext } from "@/lib/tenant";
import { listTeamChats } from "@/lib/queries/team-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in user's team chats (for the live sidebar). */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const chats = await listTeamChats(ctx.organizationId, ctx.userId);
  return Response.json(chats);
}
