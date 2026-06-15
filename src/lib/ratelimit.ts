import "server-only";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { env } from "@/lib/env";

/**
 * Rate limiting / counters backed by Upstash Redis. Used to throttle dispatch
 * per tenant+channel and to guard login. When Redis isn't configured the
 * factory returns null and callers should treat the action as allowed (the
 * feature degrades rather than breaking in local dev).
 */
let redis: Redis | null = null;

export function isRedisConfigured(): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

export function getRedis(): Redis | null {
  if (!isRedisConfigured()) return null;
  redis ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL!,
    token: env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return redis;
}

/**
 * Build a sliding-window rate limiter, or null when Redis isn't configured.
 * @param prefix  namespace, e.g. "dispatch:wa"
 * @param limit   max events per window
 * @param windowSeconds  window length in seconds
 */
export function makeRateLimiter(
  prefix: string,
  limit: number,
  windowSeconds: number,
): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  return new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix,
    analytics: false,
  });
}
