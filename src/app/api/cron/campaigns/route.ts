import { prisma } from "@/lib/prisma";
import { enqueue, isQueueConfigured } from "@/lib/queue";

export const runtime = "nodejs";

/**
 * Campaign scheduler (Vercel Cron, every minute — see vercel.json).
 * Promotes due SCHEDULED campaigns to RUNNING and enqueues a dispatch batch for
 * every RUNNING campaign. No-op when the queue isn't configured.
 */
export async function GET() {
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

  const running = await prisma.campaign.findMany({
    where: { status: "RUNNING" },
    select: { id: true },
    take: 100,
  });
  for (const c of running) {
    await enqueue("dispatch-campaign", { campaignId: c.id });
  }

  return Response.json({ ok: true, processed: running.length });
}
