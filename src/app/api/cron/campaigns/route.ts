import { prisma } from "@/lib/prisma";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import { isCronAuthorized, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

/**
 * Campaign scheduler (external cron, every minute — see README §8).
 * Promotes due SCHEDULED campaigns to RUNNING and enqueues a dispatch batch for
 * every RUNNING campaign. No-op when the queue isn't configured.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  if (!isQueueConfigured()) {
    return Response.json({ ok: true, processed: 0 });
  }

  const now = new Date();

  const due = await prisma.campaign.findMany({
    where: { status: "SCHEDULED", startAt: { lte: now } },
    select: { id: true },
    take: 100,
  });
  for (const c of due) {
    await prisma.campaign.update({ where: { id: c.id }, data: { status: "RUNNING" } });
  }

  // Only kick RUNNING campaigns that aren't already being dispatched: an active
  // campaign self-re-enqueues each throttled batch and stamps lastDispatchAt, so
  // enqueueing again here would pile jobs onto the chain and break the pacing.
  // A stale timestamp means the chain died — pick it back up.
  const staleBefore = new Date(now.getTime() - 3 * 60 * 1000);
  const running = await prisma.campaign.findMany({
    where: {
      status: "RUNNING",
      OR: [{ lastDispatchAt: null }, { lastDispatchAt: { lt: staleBefore } }],
    },
    select: { id: true },
    take: 100,
  });
  for (const c of running) {
    await enqueue("dispatch-campaign", { campaignId: c.id });
  }

  return Response.json({ ok: true, processed: running.length });
}
