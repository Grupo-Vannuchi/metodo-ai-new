/**
 * Pure rules of the "send through the company's Microsoft mailbox" channel
 * (spec 2026-10-15). No server imports, so check:email and the composer can
 * import it.
 */
import { LIMITS } from "@/config/limits";

/** Tenant id Microsoft puts in the id token of personal accounts (outlook.com, hotmail.com, live.com). */
export const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

export type MicrosoftAccountKind = "personal" | "work";

/** Personal account vs. Microsoft 365, from the id token's `tid` claim. */
export function accountKindFromTid(tid: unknown): MicrosoftAccountKind {
  return typeof tid === "string" && tid.toLowerCase() === MICROSOFT_CONSUMER_TENANT_ID ? "personal" : "work";
}

/** Estimated sends per 24 h for a mailbox kind (Microsoft doesn't expose the real figure). */
export function microsoftDailyLimit(kind: string): number {
  return kind === "personal" ? LIMITS.microsoftDailyPersonal : LIMITS.microsoftDailyWork;
}

/** What is left of the estimated daily limit (never negative). */
export function remainingToday(limit: number, usedLast24h: number): number {
  return Math.max(0, limit - Math.max(0, usedLast24h));
}

/**
 * Prisma `where` (EmailBroadcastRecipient) for the e-mails that left, or may
 * have left, one Microsoft mailbox in the last 24 h. `sentAt` is stamped when
 * a recipient is reserved, so SENDING and UNCERTAIN count too.
 */
export function sentLast24hWhere(accountId: string, now: Date) {
  return {
    status: { in: ["SENT", "SENDING", "UNCERTAIN"] as ("SENT" | "SENDING" | "UNCERTAIN")[] },
    sentAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    broadcast: { senderAccountId: accountId },
  };
}

/** One e-mail every 2.1 s per mailbox: ~28 per minute, under Exchange's 30. */
export const MICROSOFT_PACE_MS = 2_100;

/** Minutes the dispatcher needs for `count` e-mails at MICROSOFT_PACE_MS (at least 1). */
export function microsoftSendMinutes(count: number): number {
  return Math.max(1, Math.ceil((Math.max(0, count) * MICROSOFT_PACE_MS) / 60_000));
}

/** Graph refuses requests over ~4 MB (413): a direct send's base64 MIME stays under this. */
export const MICROSOFT_DIRECT_MAX_BASE64 = 3_900_000;
/** Above this many raw attachment bytes the double base64 can't fit: skip building the full MIME. */
export const MICROSOFT_DIRECT_MAX_FILE_BYTES = 2_200_000;

/** "direct" = one POST /me/sendMail; "draft" = draft + attachments + send (needs Mail.ReadWrite). */
export function microsoftSendPath(fileBytes: number, mimeBase64Length: number | null): "direct" | "draft" {
  if (fileBytes > MICROSOFT_DIRECT_MAX_FILE_BYTES) return "draft";
  if (mimeBase64Length !== null && mimeBase64Length > MICROSOFT_DIRECT_MAX_BASE64) return "draft";
  return "direct";
}

/** Graph: a file under 3 MB goes in one POST; from 3 MB on, through an upload session. */
export const UPLOAD_SESSION_MIN_BYTES = 3 * 1024 * 1024;
/** Upload-session chunk: a multiple of 320 KiB, under the 4 MB per PUT. */
export const UPLOAD_CHUNK_BYTES = 320 * 1024 * 12;

export function attachmentUploadMode(size: number): "inline" | "session" {
  return size < UPLOAD_SESSION_MIN_BYTES ? "inline" : "session";
}

/** Inclusive byte ranges covering `total` bytes, `chunk` bytes at a time. */
export function uploadRanges(total: number, chunk: number = UPLOAD_CHUNK_BYTES): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (let start = 0; start < total; start += chunk) {
    ranges.push({ start, end: Math.min(total, start + chunk) - 1 });
  }
  return ranges;
}

export type GraphFailureAction =
  | "refresh"
  | "retry"
  | "uncertain"
  | "recipient"
  | "daily_limit"
  | "blocked"
  | "reconnect"
  | "pause";

const DAILY_LIMIT_CODES = new Set(["ErrorExceededMessageLimit", "ErrorQuotaExceeded", "ErrorSubmissionQuotaExceeded"]);
const BLOCKED_CODES = new Set([
  "ErrorMessageSubmissionBlocked",
  "ErrorAccountSuspend",
  "ErrorAccountDisabled",
  "MailboxNotEnabledForRESTAPI",
]);
const DENIED_CODES = new Set([
  "ErrorAccessDenied",
  "AccessDenied",
  "Authorization_RequestDenied",
  "ErrorInsufficientPermissionsInAccessToken",
]);

/**
 * What the Microsoft dispatcher does with a failed Graph call. `stage` "send"
 * is the call that hands the e-mail over (sendMail, or the draft's send): a
 * timeout there may have gone through, so it is never retried ("uncertain").
 * `attempt` counts earlier retries of this same e-mail.
 */
export function graphFailureAction(
  status: number,
  code: string | null,
  attempt: number,
  stage: "prepare" | "send",
): GraphFailureAction {
  if (code && DAILY_LIMIT_CODES.has(code)) return "daily_limit";
  if (code && BLOCKED_CODES.has(code)) return "blocked";
  if (status === 401) return attempt < 1 ? "refresh" : "reconnect";
  if (status === 403) return code && DENIED_CODES.has(code) ? "reconnect" : "pause";
  if (status === 413 || code === "ErrorMessageSizeExceeded") return "pause";
  if (status === 0 || status === 504) return stage === "send" ? "uncertain" : attempt < 3 ? "retry" : "pause";
  if (status === 429) return attempt < 5 ? "retry" : "pause";
  if (status >= 500) return attempt < 3 ? "retry" : "pause";
  if (status >= 400) return "recipient";
  return "pause";
}

export type MicrosoftConnectError = "cancelled" | "admin_required" | "not_configured" | "failed";

/** The OAuth callback's `error` + `error_description` as a screen message key. */
export function microsoftConsentError(error: string, description: string): MicrosoftConnectError {
  if (error === "consent_required" || /AADSTS(90094|90095|65001)/.test(description)) return "admin_required";
  if (error === "access_denied") return "cancelled";
  return "failed";
}

/** Site URL + path with exactly one slash between (prod's NEXT_PUBLIC_SITE_URL ends in "/"). */
export function joinSiteUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
