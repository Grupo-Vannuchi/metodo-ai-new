import { getOrgContext } from "@/lib/tenant";
import { listFeed } from "@/lib/queries/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The team feed (last 24h), refetched live by the feed page. */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const posts = await listFeed(ctx.organizationId, ctx.userId);
  return Response.json(posts);
}
