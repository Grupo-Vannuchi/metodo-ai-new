export const runtime = "nodejs";

/**
 * Campaign scheduler (Vercel Cron, every minute — see vercel.json).
 * Finds due campaigns and enqueues their recipients. Implemented in P6; this
 * stub keeps the endpoint live so the cron can be wired now.
 */
export async function GET() {
  return Response.json({ ok: true, processed: 0 });
}
