import { getOrgContext } from "@/lib/tenant";
import { syncConversationAvatar } from "@/lib/whatsapp/avatar";
import { canAccessConversation } from "@/lib/queries/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * On-demand WhatsApp profile-picture fetch. The inbox calls this for
 * conversations it hasn't checked yet (lazy); cached weekly server-side.
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  let conversationId = "";
  let force = false;
  try {
    const body = (await req.json()) as { conversationId?: string; force?: boolean };
    conversationId = String(body?.conversationId ?? "");
    force = Boolean(body?.force);
  } catch {
    /* ignore */
  }
  if (!conversationId) return new Response("Bad request", { status: 400 });
  const viewer = { userId: ctx.userId, role: ctx.role };
  if (!(await canAccessConversation(ctx.organizationId, conversationId, viewer))) {
    return new Response("Forbidden", { status: 403 });
  }

  const result = await syncConversationAvatar(ctx.organizationId, conversationId, new Date(), force);
  return Response.json(result);
}
