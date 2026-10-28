/**
 * Pure rules of the "send through an SMTP account" channel (spec 2026-10-21).
 * No server imports and no node built-ins, so check:email and the account form
 * can import it (the address guard, which needs node:net, is in address.ts).
 */
import { LIMITS } from "@/config/limits";
import type { ImapSettings } from "../imap/core";
import { MAILBOX_PACE_MS, type MailboxFailureAction } from "../mailbox/core";

/** The ports the form accepts: 465 (TLS from the start), 587 (STARTTLS) and the 2525 alternative. Never 25. */
export const SMTP_PORTS = [465, 587, 2525] as const;
export type SmtpPort = (typeof SMTP_PORTS)[number];

/** "ssl" = TLS from the first byte (port 465); "starttls" = plain greeting, upgraded to TLS before the login. */
export type SmtpSecurity = "ssl" | "starttls";

/**
 * What is stored (sealed) for an account and what a connection is opened with.
 * `imap` is where the account's inbox is read from (spec 2026-10-23), with the
 * same user and password: null or absent, the account only sends.
 */
export type SmtpSettings = {
  host: string;
  port: SmtpPort;
  security: SmtpSecurity;
  username: string;
  password: string;
  imap?: ImapSettings | null;
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
 * command ("data" also when it hangs up with a refusal mid-envelope);
 * "message" the server's final answer after the content; "transfer" a network
 * failure or timeout, with no refusal, while the e-mail was being handed over.
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

/** What an SMTP library error tells (nodemailer's `code`, `command`, `message` and the server's `responseCode`). */
type SmtpErrorFacts = { code?: string | null; command?: string | null; message?: string | null; responseCode?: number | null };

const TLS_TEXT = /certificate|self[- ]signed|altname|unable to verify|wrong version number|ssl routines/i;

/**
 * Certificate or handshake trouble: nodemailer's ETLS, Node's ERR_TLS_*, or
 * OpenSSL's own wording. EPROTOCOL (the server did not greet like SMTP) never
 * is: its text is the server's, not a handshake's.
 */
function isTlsFailure(e: SmtpErrorFacts): boolean {
  const code = e.code ?? "";
  if (code === "EPROTOCOL") return false;
  if (code === "ETLS" || code === "EPROTO" || code.startsWith("ERR_TLS")) return true;
  return TLS_TEXT.test(e.message ?? "");
}

/**
 * The phase of a failed SMTP step ("connect" covers the greeting and the TLS,
 * "login" the AUTH, "send" the envelope and the content). Before the content
 * leaves, a failure is a preparation failure and the e-mail can try again (a
 * greeting that isn't SMTP's, EPROTOCOL, is a connection failure too). At
 * "send", the server *answering* no is a refusal and never uncertain (it did
 * not accept the e-mail); a network failure or a timeout may have come after
 * the final dot, so it is "transfer": uncertain, never sent again. An envelope
 * refusal that names no known command counts as DATA: the server said no
 * before any content left, and it is not about one sender or recipient. So
 * does a server that hangs up with a refusal (a reply code of 400 or more on
 * a dropped connection): with PIPELINING a RCPT TO answered "421" ends the
 * session before DATA, and the content only ever leaves after DATA's 354. It
 * is the server refusing at its own level, as DATA does (a 4xx is retried,
 * then pauses): never uncertain.
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
    // nodemailer puts a reply on a dropped connection only when the server refused and closed: never uncertain.
    if ((e.responseCode ?? 0) >= 400) return "data";
    return "transfer";
  }
  if (step === "login") {
    if (code === "EAUTH") return "auth";
    if (code === "ENOAUTH") return "noauth";
  }
  return isTlsFailure(e) ? "tls" : "connect";
}

/** An enhanced status code (RFC 3463) as its subject and detail: "5.1.8" is subject 1, detail 8. */
type EnhancedCode = { subject: number; detail: number };

const ENHANCED_CODE = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/;

/** The answer's first enhanced status code; null when it has none or the first is a 2.x.x (a success's). */
function enhancedCode(message: string): EnhancedCode | null {
  const match = ENHANCED_CODE.exec(message);
  return match && match[1] !== "2" ? { subject: Number(match[2]), detail: Number(match[3]) } : null;
}

/** x.1.7 and x.1.8: the SENDER's address and system, the account's, not the recipient's. */
function isSenderCode(code: EnhancedCode | null): boolean {
  return code?.subject === 1 && (code.detail === 7 || code.detail === 8);
}

/** x.2.3: the message is longer than the server allows. */
function isLengthCode(code: EnhancedCode | null): boolean {
  return code?.subject === 2 && code.detail === 3;
}

/** x.1.x (a recipient's address) or x.2.x (its mailbox), except the sender's x.1.7/x.1.8 and the length x.2.3. */
function isRecipientCode(code: EnhancedCode | null): boolean {
  return (code?.subject === 1 || code?.subject === 2) && !isSenderCode(code) && !isLengthCode(code);
}

const SENDER_TEXT =
  /sender address rejected|not owned by user|relay access denied|relaying denied|sendasdenied|permissions? to send as|not allowed to send as/i;

/**
 * The answer is about the sender or about relaying (x.1.7, x.1.8 or those
 * words, Office 365's "SendAsDenied" and "permission to send as" included):
 * the account's problem on whichever command it comes back. Postfix says it at
 * RCPT TO, but it is not each recipient's fault.
 */
function isSenderAnswer(message: string): boolean {
  return isSenderCode(enhancedCode(message)) || SENDER_TEXT.test(message);
}

const SIZE_TEXT = /\b5\.3\.4\b|message size|too large|too big|tamanho/i;

/**
 * The server says the message is too big for it: a limit of this e-mail, not
 * of the account. By 5.3.4, x.2.3 or the words; and by a bare 552 at the final
 * answer, unless that answer carries an address or mailbox code (a "552 5.2.2"
 * is a full mailbox).
 */
export function isSmtpSizeRefusal(code: string | null, message: string): boolean {
  const enhanced = enhancedCode(message);
  if (SIZE_TEXT.test(message) || isLengthCode(enhanced)) return true;
  return code === "message-552" && enhanced?.subject !== 1 && enhanced?.subject !== 2;
}

const LIMIT_TEXT = /\b(rate|limit|quota|cota|too many|limite|excedid)/i;
// Words that make a limit the account's SENDING limit ("rate", "per hour", "daily", "envio", "cota diária"...).
const SENDING_TEXT =
  /\b(rate|send|sending|sender|sent|envio|envios|enviar|hour|hourly|day|daily|hora|horas|dia|diario|diário|diaria|diária)\b/i;
// An address the server echoes back, in angle brackets or bare ("<dia@empresa.com.br>", "envio@loja.com").
const ECHOED_ADDRESS = /<[^<>]*>|[^\s<>]+@[^\s<>]+/g;

/**
 * A sending word in the server's own words. The addresses it echoes back are
 * left out first: they are names, so a recipient "dia@..." or "envio@..." never
 * turns that mailbox's "quota exceeded" into the account's sending limit.
 */
function hasSendingWord(message: string): boolean {
  return SENDING_TEXT.test(message.replace(ECHOED_ADDRESS, " "));
}

/**
 * A limit word in the server's own words, with the echoed addresses left out
 * the same way: "cota" opens "<cotacao@fornecedor.com.br>" and "@cotabest.com.br",
 * and a recipient with such a name must not turn its own refusal into the
 * account's limit.
 */
function hasLimitWord(message: string): boolean {
  return LIMIT_TEXT.test(message.replace(ECHOED_ADDRESS, " "));
}

/**
 * The answer is one recipient's own: its address or mailbox (x.1.x, x.2.x), or
 * limit words with no sign of being the account's sending limit (no sending
 * word, no x.7.x policy code), like a bare "Over quota" or "Cota excedida para
 * o usuario": that is the mailbox's. Limit and sending words are both read
 * outside the addresses the server echoes back.
 */
function isRecipientAnswer(message: string): boolean {
  const enhanced = enhancedCode(message);
  if (isRecipientCode(enhanced)) return true;
  return hasLimitWord(message) && !hasSendingWord(message) && enhanced?.subject !== 7;
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
 *  4. a 421 (the server closing the channel) on any command after that: the
 *     server's, never one recipient's; with limit words "daily_limit",
 *     otherwise 5 retries, then pause;
 *  5. after the login, an answer about the sender or the relay: blocked (the
 *     account's, whichever command it comes back on);
 *  6. the message is too big: this recipient fails;
 *  7. this recipient's own answer at RCPT TO, DATA or the final answer (an
 *     address or mailbox code x.1.x/x.2.x, or limit words with no sending word
 *     and no x.7.x code, like "Over quota"): 5 retries if temporary, then this
 *     recipient fails;
 *  8. the answer talks about a limit: pause with "daily_limit";
 *  9. RCPT TO refused for any other reason: same as 7;
 * 10. any other 5xx: MAIL FROM blocks the account, the final answer fails this
 *     recipient, DATA and the rest pause;
 * 11. any other 4xx: 5 retries, then pause; anything else: pause.
 * Limit words (4, 7, 8) and sending words (7) are read outside the addresses
 * the server echoes back: they are names, not words.
 * What belongs to one recipient (6, 7, 9) never pauses: a pause hands the
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
  // 421 is the server closing the channel ("service not available"): about the server, never one recipient, whatever
  // command it answered. Ahead of the size and recipient rules, so "421 Too many connections" is not a recipient's.
  if (status === 421) {
    if (hasLimitWord(message)) return "daily_limit";
    return attempt < 5 ? "retry" : "pause";
  }
  const afterLogin = phase === "mail" || phase === "rcpt" || phase === "data" || phase === "message";
  // The sender or the relay refused: ahead of the size and recipient rules, whatever the command it came back on.
  if (afterLogin && isSenderAnswer(message)) return "blocked";
  // Before the limit rule: "message size exceeds fixed limit" has the word "limit" in it.
  if (isSmtpSizeRefusal(code, message)) return "recipient";
  // This recipient's own refusal (not at MAIL FROM, where the same words are the sender's). It also comes before the
  // limit rule, because "Over quota" is the mailbox's. The retries run out into a recipient failure.
  const atRecipient = phase === "rcpt" || phase === "data" || phase === "message";
  if (atRecipient && isRecipientAnswer(message)) return temporary && attempt < 5 ? "retry" : "recipient";
  if (hasLimitWord(message)) return "daily_limit";
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

/**
 * Where a password goes: the server it is sent to and the user it is sent as,
 * and, when the account reads its inbox, the IMAP server it is sent to as well.
 * An `imap` left out is an inbox that is off, like null.
 */
type SmtpDestination = {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  imap?: ImapSettings | null;
};

/**
 * Whether the inbox login goes where the saved password was typed for. With no
 * inbox to send it to (off before and after, or being switched off) there is
 * nothing to leak; an inbox switched on, or moved to another server, port or
 * security, would send the saved password to a server it wasn't typed for.
 */
function keepsImapDestination(saved: ImapSettings | null | undefined, next: ImapSettings | null | undefined): boolean {
  if (!next) return true;
  if (!saved) return false;
  return saved.host === next.host && saved.port === next.port && saved.security === next.security;
}

/**
 * Whether an edit may keep the saved password when the form's is empty: only
 * for a connected account, and only if the server, port, security and user are
 * the same, and so are the IMAP server, port and security when the inbox is on,
 * so a stored password never goes to a destination it wasn't typed for.
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
    saved.username === next.username &&
    keepsImapDestination(saved.imap, next.imap)
  );
}

/**
 * The settings the form typed with the saved password, for an edit that left the
 * password field empty: only when canKeepSmtpPassword allows it, otherwise null
 * (the password has to be typed). All the rest is the form's, `imap` included, so
 * an edit that doesn't touch the inbox keeps it, and switching it off removes it
 * from what is saved.
 */
export function withSavedSmtpPassword(
  saved: (SmtpSettings & { status: "ACTIVE" | "NEEDS_RECONNECT" }) | null,
  next: Omit<SmtpSettings, "password">,
): SmtpSettings | null {
  if (saved === null || !canKeepSmtpPassword(saved, next)) return null;
  return { ...next, password: saved.password };
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
  "EPROTOCOL",
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
