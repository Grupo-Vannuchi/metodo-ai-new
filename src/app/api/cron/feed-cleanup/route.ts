import { prisma } from "@/lib/prisma";
import { FEED_TTL_MS } from "@/lib/feed";

export const runtime = "nodejs";

/**
 * Hard-deletes feed posts older than 24h (children cascade). The feed already
 * hides them by query, but this keeps the data ephemeral (LGPD) and the table
 * small. Protected by CRON_SECRET (Vercel sends it as `Authorization: Bearer`).
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const cutoff = new Date(Date.now() - FEED_TTL_MS);
  const { count } = await prisma.feedPost.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return Response.json({ ok: true, deleted: count });
}
