import { prisma } from "@/lib/prisma";
import { FEED_TTL_MS } from "@/lib/feed";
import { isCronAuthorized, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

/**
 * Hard-deletes feed posts older than 24h (children cascade). The feed already
 * hides them by query, but this keeps the data ephemeral (LGPD) and the table
 * small. Protected by CRON_SECRET (see lib/cron-auth).
 */

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  const cutoff = new Date(Date.now() - FEED_TTL_MS);
  const { count } = await prisma.feedPost.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return Response.json({ ok: true, deleted: count });
}
