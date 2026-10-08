/**
 * How long a transactional e-mail (login, invite, reset) waits before its one
 * retry after a 429: Resend's Retry-After seconds, capped at 2s because a
 * person is waiting on that request; 1s when the header is missing or invalid.
 * The platform's Resend account is shared with the mass e-mail, so a big send
 * can briefly hit the account's rate limit. Pure: no env, no server-only.
 */
export function transactionalRetryDelayMs(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  const wait = Number.isFinite(seconds) && seconds > 0 ? seconds : 1;
  return Math.min(wait, 2) * 1000;
}
