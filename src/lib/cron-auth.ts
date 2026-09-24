import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Shared guard for the `/api/cron/*` endpoints.
 *
 * These routes are reachable from the public internet: `src/proxy.ts` excludes
 * `/api/*` from the middleware matcher, so nothing protects them but the check
 * each route makes itself. This guard lives here rather than being copied per
 * route on purpose — it was copy-pasted before, and two of the four routes
 * shipped with no check at all (`campaigns` enqueued dispatch batches for every
 * RUNNING campaign to any anonymous caller).
 *
 * Fails closed: with no CRON_SECRET set, every request is rejected. The caller
 * sends `Authorization: Bearer <CRON_SECRET>`.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;

  const provided = req.headers.get("authorization");
  if (!provided) return false;

  // Constant-time compare so the secret can't be recovered byte by byte.
  // timingSafeEqual throws when the buffers differ in length, so guard on that
  // first — length alone leaks nothing useful about a fixed-length secret.
  const a = Buffer.from(provided);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Uniform rejection — no detail, so probes learn nothing from the response. */
export function cronUnauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}
