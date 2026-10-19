/**
 * Why a send paused or a recipient failed, as an i18n key plus the technical
 * text (spec 2026-10-15, section 6.5). Pure: the sends list, the report and
 * check:email share it. Every channel (platform, Microsoft and Google) uses it.
 */

/** The stored channel of a send (the EmailChannel enum, kept pure here). */
export type MailboxChannel = "PLATFORM" | "MICROSOFT" | "GOOGLE";

export const PAUSED_REASONS = [
  "no_connection",
  "quota",
  "provider_error",
  "domain_not_allowed",
  "from_missing",
  "attachment_unavailable",
  "attachment_invalid",
  "daily_limit",
  "reconnect",
  "no_sender_account",
  "account_blocked",
] as const;
export type PausedReason = (typeof PAUSED_REASONS)[number];

// Reasons the Google channel words differently from the others.
const GOOGLE_PAUSED_MESSAGES: readonly PausedReason[] = [
  "daily_limit",
  "reconnect",
  "no_sender_account",
  "account_blocked",
  "provider_error",
];
// The sends list only has a Google wording for these (provider_error stays generic there).
const GOOGLE_LIST_MESSAGES: readonly PausedReason[] = ["daily_limit", "reconnect", "no_sender_account", "account_blocked"];

/** The i18n key (under emailBroadcast) of the paused text on the report page, by channel. */
export function pausedMessageKey(channel: MailboxChannel, reason: PausedReason): string {
  if (channel === "MICROSOFT" && reason === "provider_error") return "paused.provider_error_microsoft";
  if (channel === "GOOGLE" && GOOGLE_PAUSED_MESSAGES.includes(reason)) return `paused.google_${reason}`;
  return `paused.${reason}`;
}

/** The i18n key of the red line under a paused send in the sends list, by channel. */
export function listPausedMessageKey(channel: MailboxChannel, reason: PausedReason): string {
  if (channel === "GOOGLE" && GOOGLE_LIST_MESSAGES.includes(reason)) return `listReason.paused.google_${reason}`;
  return `listReason.paused.${reason}`;
}

/** A stored pausedReason narrowed to a known key ("provider_error" for anything else). */
export function pausedReasonKey(reason: string | null | undefined): PausedReason {
  return (PAUSED_REASONS as readonly string[]).includes(reason ?? "") ? (reason as PausedReason) : "provider_error";
}

/** Stored as `error` on a recipient left UNCERTAIN by an interrupted run. */
export const INTERRUPTED_ERROR = "interrupted";
const MS_PREFIX = "ms:";
const GG_PREFIX = "gg:";

/** How a Graph failure is stored on a recipient: "ms:<code>|<message>", 500 chars max. */
export function microsoftRecipientError(code: string | null, message: string): string {
  return `${MS_PREFIX}${code ?? "unknown"}|${message}`.slice(0, 500);
}

/** How a Gmail API failure is stored on a recipient: "gg:<code>|<message>", 500 chars max. */
export function googleRecipientError(code: string | null, message: string): string {
  return `${GG_PREFIX}${code ?? "unknown"}|${message}`.slice(0, 500);
}

export type RecipientFailureKey = "invalid_address" | "message_too_large" | "interrupted" | "generic";

const INVALID_ADDRESS_CODES = new Set(["ErrorInvalidRecipients", "ErrorInvalidRecipientsPartial", "ErrorInvalidEmailAddress"]);
const GOOGLE_INVALID_ADDRESS_CODES = new Set(["badRequest", "invalidArgument"]);

/** Splits "<prefix><code>|<message>" into the code and the "code: message" technical text. */
function splitStoredError(error: string, prefix: string): { code: string; technical: string } {
  const bar = error.indexOf("|");
  const code = bar === -1 ? error.slice(prefix.length) : error.slice(prefix.length, bar);
  const message = bar === -1 ? "" : error.slice(bar + 1);
  return { code, technical: message ? `${code}: ${message}` : code };
}

/** The translated reason of a recipient's stored error (null = no error). */
export function recipientFailure(
  error: string | null | undefined,
): { key: RecipientFailureKey; technical: string } | null {
  if (!error) return null;
  if (error === INTERRUPTED_ERROR) return { key: "interrupted", technical: error };
  if (error.startsWith(MS_PREFIX)) {
    const { code, technical } = splitStoredError(error, MS_PREFIX);
    if (INVALID_ADDRESS_CODES.has(code)) return { key: "invalid_address", technical };
    if (code === "ErrorMessageSizeExceeded") return { key: "message_too_large", technical };
    return { key: "generic", technical };
  }
  if (error.startsWith(GG_PREFIX)) {
    const { code, technical } = splitStoredError(error, GG_PREFIX);
    if (GOOGLE_INVALID_ADDRESS_CODES.has(code)) return { key: "invalid_address", technical };
    return { key: "generic", technical };
  }
  // Resend: free text from its API.
  const lower = error.toLowerCase();
  if (lower.includes("invalid") && (lower.includes("`to`") || lower.includes("email address") || lower.includes("recipient"))) {
    return { key: "invalid_address", technical: error };
  }
  return { key: "generic", technical: error };
}

export type ListReason =
  | { kind: "paused"; reason: PausedReason }
  | { kind: "problems"; failed: number; uncertain: number }
  | null;

/** The red line under a send's status in the sends list (null = nothing to say). */
export function listReason(input: {
  status: string;
  pausedReason: string | null;
  problems: number;
  uncertain: number;
}): ListReason {
  if (input.status === "PAUSED") return { kind: "paused", reason: pausedReasonKey(input.pausedReason) };
  if ((input.status === "DONE" || input.status === "SENDING") && (input.problems > 0 || input.uncertain > 0)) {
    return { kind: "problems", failed: input.problems, uncertain: input.uncertain };
  }
  return null;
}
