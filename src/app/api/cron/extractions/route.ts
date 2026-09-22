import { prisma } from "@/lib/prisma";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import { isCronAuthorized, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

/** Google Places data is kept only transiently (ToS + LGPD data minimisation). */
const RETENTION_DAYS = 30;
/** A running job untouched for this long is considered stuck and re-enqueued. */
const STUCK_MINUTES = 5;

/**
 * Prospecting maintenance (external cron — see README §8). Prunes old jobs
 * (and their leads, via cascade) past the retention window, and re-enqueues any
 * stuck jobs as a safety net. No-op resume when the queue isn't configured.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  const pruned = await prisma.extractionJob.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  let resumed = 0;
  if (isQueueConfigured()) {
    const stale = new Date(Date.now() - STUCK_MINUTES * 60_000);
    const stuck = await prisma.extractionJob.findMany({
      where: { status: { in: ["QUEUED", "RUNNING"] }, updatedAt: { lt: stale } },
      select: { id: true },
      take: 100,
    });
    for (const j of stuck) {
      await enqueue("extraction-run", { jobId: j.id });
      resumed++;
    }
  }

  return Response.json({ ok: true, pruned: pruned.count, resumed });
}
