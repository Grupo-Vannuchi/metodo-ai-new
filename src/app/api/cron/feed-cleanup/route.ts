import { prisma } from "@/lib/prisma";
import { isCronAuthorized, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

/**
 * Hard-deletes feed posts whose expiry has passed (children cascade). The wall
 * already hides them by query; this is what actually drops the rows, so the
 * ephemeral posts stay ephemeral (LGPD) and the table stays small.
 * Protected by CRON_SECRET (see lib/cron-auth).
 *
 * Deletes by `expiresAt`, never by age: permanent posts carry `expiresAt = null`
 * and NULL never satisfies `<`. Pinned posts are excluded explicitly rather than
 * by relying on a null expiry — pinning no longer rewrites `expiresAt`, so a
 * pinned post can legitimately carry an expiry that has already passed. This
 * route used to filter on `createdAt`, which hard-deleted *every* post over 24h
 * old — pinned and permanent included — and would have destroyed data the moment
 * it was scheduled.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  const { count } = await prisma.feedPost.deleteMany({
    where: { pinnedAt: null, expiresAt: { lt: new Date() } },
  });
  return Response.json({ ok: true, deleted: count });
}
