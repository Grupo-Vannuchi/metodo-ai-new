/**
 * Pure rules of the "send through an SMTP account" channel (spec 2026-10-21).
 * No server imports and no node built-ins, so check:email and the account form
 * can import it (the address guard, which needs node:net, is in address.ts).
 */
import { LIMITS } from "@/config/limits";
import { MAILBOX_PACE_MS, type MailboxFailureAction } from "../mailbox/core";

/** The ports the form accepts: 465 (TLS from the start), 587 (STARTTLS) and the 2525 alternative. Never 25. */
export const SMTP_PORTS = [465, 587, 2525] as const;
export type SmtpPort = (typeof SMTP_PORTS)[number];

/** "ssl" = TLS from the first byte (port 465); "starttls" = plain greeting, upgraded to TLS before the login. */
export type SmtpSecurity = "ssl" | "starttls";

/** What is stored (sealed) for an account and what a connection is opened with. */
export type SmtpSettings = {
  host: string;
  port: SmtpPort;
  security: SmtpSecurity;
  username: string;
  password: string;
};

/** The form's suggestion for a port; the person can still change it. */
export function defaultSmtpSecurity(port: SmtpPort): SmtpSecurity {
  return port === 465 ? "ssl" : "starttls";
}

/** E-mails per 24 h: the company's own figure, or the default while the column is empty. */
export function smtpDailyLimit(account: { dailyLimit: number | null }): number {
  return account.dailyLimit ?? LIMITS.smtpDailyDefault;
}

/** E-mails per hour: the company's own figure, or the default while the column is empty. */
export function smtpHourlyLimit(account: { hourlyLimit: number | null }): number {
  return account.hourlyLimit ?? LIMITS.smtpHourlyDefault;
}

/** Milliseconds between two e-mails: spaced so the hourly limit is never passed, never faster than the mailbox pace. */
export function smtpPaceMs(hourlyLimit: number): number {
  return Math.max(MAILBOX_PACE_MS, Math.ceil(3_600_000 / Math.max(1, hourlyLimit)));
}

/** Minutes the dispatcher needs for `count` e-mails at that pace (at least 1). */
export function smtpSendMinutes(count: number, hourlyLimit: number): number {
  return Math.max(1, Math.ceil((Math.max(0, count) * smtpPaceMs(hourlyLimit)) / 60_000));
}

const SMTP_PHASES = [
  "guard",
  "connect",
  "tls",
  "auth",
  "noauth",
  "mail",
  "rcpt",
  "data",
  "message",
  "transfer",
] as const;

/**
 * Where an SMTP attempt failed. "guard" is the address check before any
 * connection; "connect" and "tls" the connection and its encryption; "auth" and
 * "noauth" the login; "mail", "rcpt" and "data" the server refusing that
 * command; "message" the server's final answer after the content; "transfer" a
 * network failure or timeout while the e-mail was being handed over.
 */
export type SmtpPhase = (typeof SMTP_PHASES)[number];

/** The failure code kept with an attempt: "rcpt-550", or just the phase when the server sent no reply code. */
export function smtpFailureCode(phase: SmtpPhase, responseCode: number | null): string {
  return responseCode ? `${phase}-${responseCode}` : phase;
}

/** The phase inside a failure code ("rcpt-550" is "rcpt"); null for anything that isn't one. */
export function smtpPhaseOf(code: string | null): SmtpPhase | null {
  const phase = (code ?? "").split("-")[0];
  return (SMTP_PHASES as readonly string[]).includes(phase) ? (phase as SmtpPhase) : null;
}

/** What an SMTP library error tells (nodemailer's `code`, `command` and `message`). */
type SmtpErrorFacts = { code?: string | null; command?: string | null; message?: string | null };

const TLS_TEXT = /certificate|self[- ]signed|altname|unable to verify|wrong version number|ssl routines/i;

/** Certificate or handshake trouble: nodemailer's ETLS, Node's ERR_TLS_*, or OpenSSL's own wording. */
function isTlsFailure(e: SmtpErrorFacts): boolean {
  const code = e.code ?? "";
  if (code === "ETLS" || code === "EPROTO" || code.startsWith("ERR_TLS")) return true;
  return TLS_TEXT.test(e.message ?? "");
}

/**
 * The phase of a failed SMTP step ("connect" covers the greeting and the TLS,
 * "login" the AUTH, "send" the envelope and the content). Before the content
 * leaves, a failure is a preparation failure and the e-mail can try again. At
 * "send", the server *answering* no is a refusal and never uncertain (it did
 * not accept the e-mail); a network failure or a timeout may have come after
 * the final dot, so it is "transfer": uncertain, never sent again. An envelope
 * refusal that names no known command counts as DATA: the server said no
 * before any content left, and it is not about one sender or recipient.
 */
export function smtpSendPhase(step: "connect" | "login" | "send", e: SmtpErrorFacts): SmtpPhase {
  const code = e.code ?? "";
  if (step === "send") {
    if (code === "EMESSAGE") return "message";
    if (code === "EENVELOPE") {
      const command = e.command ?? "";
      if (/^mail/i.test(command)) return "mail";
      if (/^rcpt/i.test(command)) return "rcpt";
      return "data";
    }
    return "transfer";
  }
  if (step === "login") {
    if (code === "EAUTH") return "auth";
    if (code === "ENOAUTH") return "noauth";
  }
  return isTlsFailure(e) ? "tls" : "connect";
}

const SIZE_TEXT = /\b5\.3\.4\b|message size|too large|too big|tamanho/i;

/** The server says the message is too big for it: a limit of this e-mail, not of the account. */
export function isSmtpSizeRefusal(code: string | null, message: string): boolean {
  return code === "message-552" || SIZE_TEXT.test(message);
}

const LIMIT_TEXT = /\b(rate|limit|quota|too many|limite|excedid)/i;
const EXTENDED_CODE = /\b[245]\.\d{1,3}\.\d{1,3}\b/;

/** The answer's first enhanced status code points at the recipient's address (x.1.x) or mailbox (x.2.x). */
function isRecipientSubject(message: string): boolean {
  const extended = EXTENDED_CODE.exec(message)?.[0];
  return extended !== undefined && /^[45]\.[12]\./.test(extended);
}

/**
 * What the SMTP dispatcher does with a failed attempt (spec 5.3). `status` is
 * the server's reply code (0 when there was none), `code` the failure code
 * ("rcpt-550", see smtpFailureCode), `message` the server's text and `attempt`
 * the earlier retries of this same e-mail. The first rule that matches decides:
 *  1. a network failure while handing over: uncertain, never sent again;
 *  2. the address guard, TLS trouble, a server with no login: pause;
 *  3. a failed connection: 3 retries, then pause; a login refused with a 4xx
 *     the same; any other refused login: reconnect;
 *  4. the message is too big: this recipient fails;
 *  5. the recipient's address or mailbox (x.1.x or x.2.x, at RCPT TO, DATA or
 *     the final answer): 5 retries if temporary, then this recipient fails;
 *  6. the answer talks about a limit: pause with "daily_limit";
 *  7. RCPT TO refused for any other reason: same as 5;
 *  8. any other 5xx: MAIL FROM blocks the account, the final answer fails this
 *     recipient, DATA and the rest pause;
 *  9. any other 4xx: 5 retries, then pause; anything else: pause.
 * What belongs to one recipient (4, 5, 7) never pauses: a pause hands the
 * recipient back to the queue, the resume would pick it first and the send
 * would stall for good.
 */
export function smtpFailureAction(
  status: number,
  code: string | null,
  message: string,
  attempt: number,
): MailboxFailureAction {
  const phase = smtpPhaseOf(code);
  const temporary = status >= 400 && status < 500;
  const permanent = status >= 500 && status < 600;
  if (phase === "transfer") return "uncertain";
  if (phase === "guard") return "pause";
  if (phase === "connect") return attempt < 3 ? "retry" : "pause";
  if (phase === "tls") return "pause";
  if (phase === "auth") {
    if (!temporary) return "reconnect";
    return attempt < 3 ? "retry" : "pause";
  }
  if (phase === "noauth") return "pause";
  // Before the limit rule: "message size exceeds fixed limit" has the word "limit" in it.
  if (isSmtpSizeRefusal(code, message)) return "recipient";
  // The recipient's address or mailbox (not at MAIL FROM, where x.1.x is the sender's) and the recipient's own
  // "quota" or "rate", so this also comes before the limit rule. The retries run out into a recipient failure.
  if ((phase === "rcpt" || phase === "data" || phase === "message") && isRecipientSubject(message)) {
    return temporary && attempt < 5 ? "retry" : "recipient";
  }
  if (LIMIT_TEXT.test(message)) return "daily_limit";
  // Any other RCPT TO refusal, even one with no reply code, is this recipient's: never a pause.
  if (phase === "rcpt") return temporary && attempt < 5 ? "retry" : "recipient";
  if (permanent) {
    if (phase === "mail") return "blocked";
    if (phase === "message") return "recipient";
    return "pause";
  }
  if (temporary) return attempt < 5 ? "retry" : "pause";
  return "pause";
}

/** Where a password goes: the server it is sent to and the user it is sent as. */
type SmtpDestination = { host: string; port: number; security: SmtpSecurity; username: string };

/**
 * Whether an edit may keep the saved password when the form's is empty: only
 * for a connected account, and only if the server, port, security and user are
 * the same, so a stored password never goes to a destination it wasn't typed for.
 */
export function canKeepSmtpPassword(
  saved: (SmtpDestination & { status: "ACTIVE" | "NEEDS_RECONNECT" }) | null,
  next: SmtpDestination,
): boolean {
  return (
    saved !== null &&
    saved.status === "ACTIVE" &&
    saved.host === next.host &&
    saved.port === next.port &&
    saved.security === next.security &&
    saved.username === next.username
  );
}

/** Why the save form's connection test failed, as the screen message key. */
export type SmtpConnectError =
  | "auth_failed"
  | "tls_failed"
  | "connection_failed"
  | "host_not_found"
  | "host_not_allowed"
  | "no_auth"
  | "failed";

const AUTH_REPLIES = new Set([530, 534, 535]);
const NOT_FOUND_CODES = new Set(["EDNS", "ENOTFOUND", "EAI_AGAIN"]);
const CONNECTION_CODES = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/**
 * The connection test's error as a form failure. The TLS rule comes before the
 * connection one because TLS errors arrive wrapped in ESOCKET (587 with SSL ends
 * as "wrong version number"); 465 with STARTTLS gets no greeting and times out
 * as a connection failure. Either way the person gets a named failure, never
 * the generic one. ("host_not_allowed" comes from the address guard, not here.)
 */
export function smtpConnectError(e: {
  code?: string | null;
  responseCode?: number | null;
  message?: string | null;
}): SmtpConnectError {
  const code = e.code ?? "";
  if (code === "EAUTH" || AUTH_REPLIES.has(e.responseCode ?? 0)) return "auth_failed";
  if (code === "ENOAUTH") return "no_auth";
  if (isTlsFailure(e)) return "tls_failed";
  if (NOT_FOUND_CODES.has(code)) return "host_not_found";
  if (CONNECTION_CODES.has(code)) return "connection_failed";
  return "failed";
}
