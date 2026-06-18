import { getOrgContext } from "@/lib/tenant";
import { listConversationFolders } from "@/lib/queries/inbox";

export const runtime = "nodejs";

/** Inbox folders (refreshed by the client after folder changes). */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  return Response.json(await listConversationFolders(ctx.organizationId));
}
