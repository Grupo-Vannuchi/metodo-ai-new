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
  // HR digests — only sent to OWNER/ADMIN of orgs whose plan includes "hr".
  "HR_BIRTHDAY_TODAY",
  "HR_PROBATION_ENDING",
  "HR_DOCS_EXPIRING",
  "HR_TIMEOFF_PENDING",
] as const;

/** Created once, when the event happens (never by the cron). */
export const ASSIGN_KINDS = [
  "TASK_ASSIGNED",
  "OPP_ASSIGNED",
  "TEAM_ATTACHMENT",
  "FEED_POST",
  "FEED_MENTION",
  "FEED_REACTION",
  "HR_TIMEOFF_REQUEST",
  "HR_TIMEOFF_DECIDED",
] as const;

export type NotificationKind =
  | (typeof DIGEST_KINDS)[number]
  | (typeof ASSIGN_KINDS)[number];

/** i18n interpolation payload. `count` for digests; `actor`/`title` for
 * assignments; `actor`/`attachmentType` for a team-chat share; `actor`/`emoji`
 * for a feed reaction; `name`/`decision` for a time-off decision. */
export type NotificationData = {
  count?: number;
  actor?: string;
  title?: string;
  attachmentType?: string;
  emoji?: string;
  name?: string;
  decision?: string;
};
