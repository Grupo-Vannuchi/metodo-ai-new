import { prisma } from "@/lib/prisma";
import { enqueue, isQueueConfigured } from "@/lib/queue";

export const runtime = "nodejs";

/**
 * Extraction watchdog (Vercel Cron, every 5 minutes — see vercel.json).
 * Re-enqueues jobs left in QUEUED (e.g. paused between batches, or whose
 * callback was lost). No-op when the queue isn't configured.
 */
export async function GET() {
  if (!isQueueConfigured()) {
    return Response.json({ ok: true, processed: 0 });
  }

  const stuck = await prisma.extractionJob.findMany({
    where: { status: "QUEUED" },
    select: { id: true },
    take: 50,
  });

  for (const job of stuck) {
    await enqueue("extraction-run", { jobId: job.id });
  }

  return Response.json({ ok: true, processed: stuck.length });
}
