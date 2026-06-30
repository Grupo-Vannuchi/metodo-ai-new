import { getOrgContext } from "@/lib/tenant";
import { listMessages, canAccessConversation } from "@/lib/queries/inbox";

export const runtime = "nodejs";

/** Polled by the inbox UI for the selected conversation's messages. */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const id = new URL(req.url).searchParams.get("conversationId");
  if (!id) return Response.json([]);
  const viewer = { userId: ctx.userId, role: ctx.role };
  if (!(await canAccessConversation(ctx.organizationId, id, viewer))) {
    return Response.json([]);
  }
  return Response.json(await listMessages(ctx.organizationId, id));
}
