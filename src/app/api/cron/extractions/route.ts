export const runtime = "nodejs";

/**
 * Extraction watchdog (Vercel Cron, every 5 minutes — see vercel.json).
 * Re-enqueues stalled extraction jobs. Implemented in P5; this stub keeps the
 * endpoint live so the cron can be wired now.
 */
export async function GET() {
  return Response.json({ ok: true, processed: 0 });
}
