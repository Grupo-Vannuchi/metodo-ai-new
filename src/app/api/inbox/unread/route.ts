import { getOrgContext } from "@/lib/tenant";
import { countUnread } from "@/lib/queries/inbox";

export const runtime = "nodejs";

/** Polled by the nav to show the unread badge. */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  return Response.json({ count: await countUnread(ctx.organizationId) });
}
