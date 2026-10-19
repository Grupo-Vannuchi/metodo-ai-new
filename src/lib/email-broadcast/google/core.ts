/**
 * Pure rules of the "send through the company's Google account" channel (spec
 * 2026-10-19). No server imports, so check:email and the composer can import it.
 */
import { LIMITS } from "@/config/limits";
import type { MailboxFailureAction } from "../mailbox/core";

/** The only Gmail scope the channel asks for: send, never read. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export type GoogleAccountKind = "personal" | "work";

/** Personal Gmail vs. Google Workspace, from the id token's hosted-domain (`hd`) claim. */
export function googleAccountKind(hd: unknown): GoogleAccountKind {
  return typeof hd === "string" && hd.trim() !== "" ? "work" : "personal";
}

const CONSUMER_GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * A Workspace account (`hd` present) has Gmail through its domain. Without
 * `hd`, only a gmail.com / googlemail.com address does: any other address is a
 * Google account with no mailbox to send from.
 */
export function googleHasGmail(email: string, hd: unknown): boolean {
  if (googleAccountKind(hd) === "work") return true;
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return CONSUMER_GMAIL_DOMAINS.has(domain);
}

/** Whether the consent actually granted the send scope (the user can untick it). */
export function googleGrantedSend(scopes: readonly string[]): boolean {
  return scopes.includes(GMAIL_SEND_SCOPE);
}

/** Estimated sends per 24 h for an account kind (Google doesn't expose the real figure). */
export function googleDailyLimit(kind: string): number {
  return kind === "personal" ? LIMITS.googleDailyPersonal : LIMITS.googleDailyWork;
}

/** Gmail's simple upload takes a message up to 5 MB; above that, the resumable upload. */
export const GMAIL_SIMPLE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export function gmailUploadMode(mimeBytes: number): "simple" | "resumable" {
  return mimeBytes <= GMAIL_SIMPLE_UPLOAD_MAX_BYTES ? "simple" : "resumable";
}

/**
 * What the Google dispatcher does with a failed Gmail call. `reason` is the
 * first `errors[].reason` of the API's error body. `stage` "send" is the call
 * that hands the e-mail over (the simple POST, or the resumable PUT): a
 * timeout, a network error or a gateway 5xx (500, 502, 504...) there may have
 * gone through, so it is never retried ("uncertain"). Only 503 and 429 are
 * retried at that stage, and an exhausted retry pauses the send: it never
 * turns into a recipient failure. `attempt` counts earlier retries of this
 * same e-mail.
 */
export function gmailFailureAction(
  status: number,
  reason: string | null,
  message: string,
  attempt: number,
  stage: "prepare" | "send",
): MailboxFailureAction {
  if (status === 401) return attempt < 1 ? "refresh" : "reconnect";
  if (status === 429 && /mail sending/i.test(message)) return "daily_limit";
  if (reason === "domainPolicy" || reason === "failedPrecondition") return "blocked";
  if (reason === "dailyLimitExceeded") return "pause";
  if (reason === "insufficientPermissions") return "reconnect";
  if (status === 429 || reason === "userRateLimitExceeded" || reason === "rateLimitExceeded") {
    return attempt < 5 ? "retry" : "pause";
  }
  if (status === 0 || status >= 500) {
    if (stage === "send") {
      if (status !== 503) return "uncertain";
      return attempt < 3 ? "retry" : "pause";
    }
    return attempt < 3 ? "retry" : "pause";
  }
  if (status >= 400) return "recipient";
  return "pause";
}

export type GoogleConnectError = "cancelled" | "admin_required" | "missing_send" | "no_gmail" | "not_configured" | "failed";

/** The OAuth callback's `error` as a screen message key (the other codes are set by the callback itself). */
export function googleConsentError(error: string): GoogleConnectError {
  if (error === "access_denied") return "cancelled";
  if (error === "admin_policy_enforced") return "admin_required";
  return "failed";
}

/**
 * Pilot gate: `pilotList` is GOOGLE_MAIL_PILOT_ORG_IDS (comma-separated
 * organization ids). Empty or unset = every organization.
 */
export function pilotAllows(organizationId: string, pilotList: string | undefined): boolean {
  const ids = (pilotList ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  return ids.length === 0 || ids.includes(organizationId);
}
