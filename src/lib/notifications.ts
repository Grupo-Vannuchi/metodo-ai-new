/**
 * Persisted-notification taxonomy, shared by the writers (actions + cron) and
 * the reader (the bell). The notification row stores a `type` (one of these
 * kinds) plus a `data` JSON payload; the bell localizes it client-side via
 * `t(notifications.kind.<type>, data)`, so no human text is persisted.
 */

/** Recomputed each cron run (idempotent digest). */
export const DIGEST_KINDS = [
  "TASK_OVERDUE",
  "TASK_TODAY",
  "OPP_STALE",
  "FINANCE_OVERDUE",
  "INBOX_UNREAD",
] as const;

/** Created once, when the assignment happens (event-based, never by the cron). */
export const ASSIGN_KINDS = ["TASK_ASSIGNED", "OPP_ASSIGNED"] as const;

export type NotificationKind =
  | (typeof DIGEST_KINDS)[number]
  | (typeof ASSIGN_KINDS)[number];

/** i18n interpolation payload. `count` for digests; `actor`/`title` for
 * assignments. */
export type NotificationData = {
  count?: number;
  actor?: string;
  title?: string;
};
