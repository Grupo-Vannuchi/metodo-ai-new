import { getOrgContext } from "@/lib/tenant";
import { listConversations } from "@/lib/queries/inbox";

export const runtime = "nodejs";

/** Polled by the inbox UI for the conversation list. */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  return Response.json(await listConversations(ctx.organizationId));
}
