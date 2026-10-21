/**
 * Pure rules shared by the "send through the company's own mailbox" channels
 * (Microsoft, spec 2026-10-15; Google, spec 2026-10-19; SMTP, spec 2026-10-21).
 * No server imports, so check:email and the composer can import it.
 */

function sentSinceWhere(accountId: string, since: Date) {
  return {
    status: { in: ["SENT", "SENDING", "UNCERTAIN"] as ("SENT" | "SENDING" | "UNCERTAIN")[] },
    sentAt: { gte: since },
    broadcast: { senderAccountId: accountId },
  };
}

/**
 * Prisma `where` (EmailBroadcastRecipient) for the e-mails that left, or may
 * have left, one connected mailbox in the last 24 h. `sentAt` is stamped when
 * a recipient is reserved, so SENDING and UNCERTAIN count too.
 */
export function sentLast24hWhere(accountId: string, now: Date) {
  return sentSinceWhere(accountId, new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

/** Same count over the last 60 min: what an SMTP account's hourly limit is checked against. */
export function sentLastHourWhere(accountId: string, now: Date) {
  return sentSinceWhere(accountId, new Date(now.getTime() - 60 * 60 * 1000));
}

/** What is left of the estimated daily limit (never negative). */
export function remainingToday(limit: number, usedLast24h: number): number {
  return Math.max(0, limit - Math.max(0, usedLast24h));
}

/** One e-mail every 2.1 s per mailbox: ~28 per minute, within Exchange's 30/min and Gmail's per-user API quota. */
export const MAILBOX_PACE_MS = 2_100;

/** Minutes the dispatcher needs for `count` e-mails at MAILBOX_PACE_MS (at least 1). */
export function mailboxSendMinutes(count: number): number {
  return Math.max(1, Math.ceil((Math.max(0, count) * MAILBOX_PACE_MS) / 60_000));
}

/** The pause is stretched for at most this many sends of one account running at once. */
const MAX_PACE_FACTOR = 20;

/**
 * The pause after an e-mail: the account's pace times the sends of that same
 * account running right now (at least 1, at most 20), so all of them together
 * keep the account's pace.
 */
export function mailboxPaceWaitMs(paceMs: number, running: number): number {
  return paceMs * Math.min(Math.max(1, running), MAX_PACE_FACTOR);
}

/**
 * A wait cut into pieces of at most `maxChunkMs` (the last one takes the rest),
 * so the lease can be renewed before each piece: a long wait never outlives
 * the dispatcher's 90 s lease.
 */
export function waitChunksMs(totalMs: number, maxChunkMs = 10_000): number[] {
  const step = Math.max(1, maxChunkMs);
  const chunks: number[] = [];
  for (let left = Number.isFinite(totalMs) ? totalMs : 0; left > 0; left -= step) chunks.push(Math.min(left, step));
  return chunks;
}

/** What the dispatcher does with a failed provider call (Graph, Gmail or SMTP). */
export type MailboxFailureAction =
  | "refresh"
  | "retry"
  | "uncertain"
  | "recipient"
  | "daily_limit"
  | "blocked"
  | "reconnect"
  | "pause";

/**
 * A failed send, whichever provider. `stage` "send" is the call that hands the
 * e-mail over; "prepare" is everything before it (draft, upload...).
 */
export type MailboxSendFailure = {
  ok: false;
  status: number;
  code: string | null;
  message: string;
  retryAfter: number | null;
  stage: "prepare" | "send";
};

export type MailboxSendOutcome = { ok: true } | MailboxSendFailure;

/** OAuth refusals that only a new consent fixes: the account must be reconnected. */
const RECONNECT_CODES = new Set(["invalid_grant", "interaction_required", "consent_required", "admin_policy_enforced"]);

export function isReconnectCode(code: string): boolean {
  return RECONNECT_CODES.has(code);
}

/** Site URL + path with exactly one slash between (prod's NEXT_PUBLIC_SITE_URL ends in "/"). */
export function joinSiteUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
