/**
 * Pure rules shared by the "send through the company's own mailbox" channels
 * (Microsoft, spec 2026-10-15; Google, spec 2026-10-19). No server imports, so
 * check:email and the composer can import it.
 */

/**
 * Prisma `where` (EmailBroadcastRecipient) for the e-mails that left, or may
 * have left, one connected mailbox in the last 24 h. `sentAt` is stamped when
 * a recipient is reserved, so SENDING and UNCERTAIN count too.
 */
export function sentLast24hWhere(accountId: string, now: Date) {
  return {
    status: { in: ["SENT", "SENDING", "UNCERTAIN"] as ("SENT" | "SENDING" | "UNCERTAIN")[] },
    sentAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    broadcast: { senderAccountId: accountId },
  };
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

/** What the dispatcher does with a failed provider call (Graph or Gmail). */
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
