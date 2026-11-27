import "server-only";
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { env } from "@/lib/env";

/**
 * Rate limiting backed by Upstash Redis. Used to guard login, password reset,
 * e-mail confirmation and invitations, the AI endpoints, the MCP server and
 * the per-tenant campaign dispatch. When Redis isn't configured the factory
 * returns null and callers treat the action as allowed.
 *
 * Fail-open: once Redis IS configured, an outage, a wrong token or a slow
 * answer must not take login down with it. Every check settles within
 * `RATE_LIMIT_TIMEOUT_MS`; on an error or a timeout it lets the request through
 * and logs `[ratelimit] <prefix>: …` (at most once a minute per prefix). That
 * is the same protection as having no Redis at all, never worse. Redis only
 * sees a hash of each identifier (`rateLimitKey`), never the e-mail.
 * Covered by `npm run check:ratelimit`.
 */
export type RateLimiter = { limit(identifier: string): Promise<{ success: boolean }> };

/** How long a check may wait on Redis before letting the request through. */
export const RATE_LIMIT_TIMEOUT_MS = 2000;
const WARN_EVERY_MS = 60_000;

let redis: Redis | null = null;
const limiters = new Map<string, RateLimiter>();
const lastWarnAt = new Map<string, number>();

export function isRedisConfigured(): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

export function getRedis(): Redis | null {
  if (!isRedisConfigured()) return null;
  redis ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL!,
    token: env.UPSTASH_REDIS_REST_TOKEN!,
    // One quick retry instead of the library's five with exponential backoff:
    // a check sits in front of a login and must answer fast.
    retry: { retries: 1, backoff: () => 200 },
  });
  return redis;
}

/**
 * What goes to Redis instead of the identifier: identifiers are e-mails and
 * user ids, and Upstash is a third party, so only a hash leaves the app.
 */
export function rateLimitKey(identifier: string): string {
  return createHash("sha256").update(identifier).digest("hex").slice(0, 32);
}

function warnUnavailable(prefix: string, reason: unknown): void {
  const now = Date.now();
  if (now - (lastWarnAt.get(prefix) ?? 0) < WARN_EVERY_MS) return;
  lastWarnAt.set(prefix, now);
  // Upstash errors end with ", command was: [...]", whose keys carry the
  // identifier (an e-mail, a user id): keep it out of the log.
  const message = reason instanceof Error ? reason.message : String(reason);
  const detail = message.split(", command was:")[0].slice(0, 200);
  console.warn(`[ratelimit] ${prefix}: Redis unavailable, letting the request through (${detail})`);
}

/**
 * Get the sliding-window rate limiter for `prefix`, or null when Redis isn't
 * configured. Instances are reused per (prefix, limit, window), so the
 * library's in-memory cache of blocked identifiers survives between requests.
 * @param prefix  namespace, e.g. "login" or "dispatch:EMAIL"
 * @param limit   max events per window
 * @param windowSeconds  window length in seconds
 */
export function makeRateLimiter(
  prefix: string,
  limit: number,
  windowSeconds: number,
): RateLimiter | null {
  const r = getRedis();
  if (!r) return null;
  const key = `${prefix}|${limit}|${windowSeconds}`;
  const cached = limiters.get(key);
  if (cached) return cached;

  const inner = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix,
    analytics: false,
    timeout: RATE_LIMIT_TIMEOUT_MS,
  });
  const limiter: RateLimiter = {
    async limit(identifier) {
      try {
        const res = await inner.limit(rateLimitKey(identifier));
        if (res.reason === "timeout") warnUnavailable(prefix, `no answer in ${RATE_LIMIT_TIMEOUT_MS} ms`);
        return { success: res.success };
      } catch (e) {
        warnUnavailable(prefix, e);
        return { success: true };
      }
    },
  };
  limiters.set(key, limiter);
  return limiter;
}
