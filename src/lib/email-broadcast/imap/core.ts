/**
 * Pure rules of the inbox read over IMAP from an SMTP account (spec
 * 2026-10-23). No server imports and no node built-ins, so check:email and the
 * SMTP account form (a client component) can import it; the connection is in
 * connect.ts and the reading in inbox.ts.
 */
import type { MailboxSendOutcome } from "../mailbox/core";
import type { InboxAddress, InboxMessageSummary } from "../microsoft/inbox-core";

/** The ports the form accepts: 993 (TLS from the start) and 143 (STARTTLS, always required). Never plain text. */
export const IMAP_PORTS = [993, 143] as const;
export type ImapPort = (typeof IMAP_PORTS)[number];

/** "ssl" = TLS from the first byte (port 993); "starttls" = plain greeting, upgraded to TLS before the login. */
export type ImapSecurity = "ssl" | "starttls";

/** Where the inbox is read from. The user and password are the SMTP account's own. */
export type ImapSettings = { host: string; port: ImapPort; security: ImapSecurity };

/** The form's suggestion for a port; the person can still change it. */
export function defaultImapSecurity(port: ImapPort): ImapSecurity {
  return port === 993 ? "ssl" : "starttls";
}

/**
 * The IMAP server to suggest from the SMTP one: the first label `smtp`, `smtpi`
 * or `smtps` becomes `imap` (smtpi.kinghost.net → imap.kinghost.net), any other
 * host is suggested as it is (mail.empresa.com.br). Lower case; blank stays blank.
 */
export function suggestImapHost(smtpHost: string): string {
  return smtpHost.trim().toLowerCase().replace(/^(smtp|smtpi|smtps)\./, "imap.");
}

/** UIDVALIDITY and UID are 32-bit numbers and never zero (RFC 3501, 2.3.1). */
const MAX_UINT32 = 4_294_967_295;
/** Digits only, no leading zero: one spelling per e-mail. */
const MESSAGE_REF_RE = /^([1-9]\d{0,9})\.([1-9]\d{0,9})$/;

/**
 * An e-mail's id in the URL (`msg=`): `<uidvalidity>.<uid>`. The UIDVALIDITY says
 * which numbering the UID belongs to, so an id kept from before the server
 * renumbered its mailbox finds nothing instead of another e-mail.
 */
export function imapMessageRef(uidValidity: number, uid: number): string {
  return `${uidValidity}.${uid}`;
}

/** The inverse of imapMessageRef; null for anything that isn't one (it comes from the URL). */
export function parseImapMessageRef(value: unknown): { uidValidity: number; uid: number } | null {
  if (typeof value !== "string") return null;
  const match = MESSAGE_REF_RE.exec(value);
  if (!match) return null;
  const uidValidity = Number(match[1]);
  const uid = Number(match[2]);
  return uidValidity <= MAX_UINT32 && uid <= MAX_UINT32 ? { uidValidity, uid } : null;
}

/** An attachment's id in the URL (`a=`): its index in the parsed e-mail's attachment list, one to three digits. */
export function isAttachmentIndex(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,3}$/.test(value);
}

/** Why a connection test (or the inbox itself) failed, as the screen message key. */
export type ImapConnectError =
  | "auth_failed"
  | "tls_failed"
  | "connection_failed"
  | "host_not_found"
  | "host_not_allowed"
  | "failed";

const TLS_CODE = /^(ERR_TLS_|ERR_SSL_|ERR_OSSL_|STARTTLS_)|^(EPROTO|UPGRADE_TIMEOUT)$|CERT|SELF_SIGNED|UNABLE_TO_VERIFY/;
const TLS_TEXT = /certificate|self[- ]signed|altname|unable to verify|wrong version number|ssl routines|starttls/i;
const NOT_FOUND_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EDNS"]);
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  // imapflow's own: the inactivity watchdog, the connection and the greeting deadlines, a closed socket.
  "ETIMEOUT",
  "CONNECT_TIMEOUT",
  "GREETING_TIMEOUT",
  "NoConnection",
  "EConnectionClosed",
]);

/**
 * An imapflow error as a form failure. A refused login comes first (imapflow
 * flags it with `authenticationFailed`, whatever else the error says); then TLS,
 * since certificate trouble arrives wrapped in connection errors (143 with a
 * server that can't do STARTTLS is flagged by imapflow only through its message,
 * and is a TLS failure too: the login is never sent in plain text); then a name
 * that doesn't resolve, then the connection itself. A greeting that never comes
 * (STARTTLS asked on a port that speaks TLS from the first byte) times out as a
 * connection failure; TLS asked on a plain-text port fails the handshake, a TLS
 * failure. ("host_not_allowed" comes from the address guard, not here.)
 */
export function imapConnectError(e: {
  authenticationFailed?: boolean;
  code?: string | null;
  message?: string | null;
}): ImapConnectError {
  const code = e.code ?? "";
  if (e.authenticationFailed) return "auth_failed";
  if (TLS_CODE.test(code) || TLS_TEXT.test(e.message ?? "")) return "tls_failed";
  if (NOT_FOUND_CODES.has(code)) return "host_not_found";
  if (CONNECTION_CODES.has(code) || code.startsWith("ClosedAfterConnect")) return "connection_failed";
  return "failed";
}

/** Where servers keep the sent mail when they don't mark it \Sent (KingHost: INBOX.Sent), in the order to try. */
const SENT_FOLDER_NAMES = ["INBOX.Sent", "Sent", "INBOX.Enviados", "Enviados", "Sent Items", "Itens Enviados"];

/**
 * The folder a copy of the reply goes to: the one the server marks \Sent
 * (RFC 6154) or else the first of the usual names that exists, whatever its
 * case. Null when there is none; the reply is sent all the same, just not kept.
 */
export function pickSentFolder(folders: { path: string; specialUse?: string | null }[]): string | null {
  const marked = folders.find((f) => (f.specialUse ?? "").toLowerCase() === "\\sent");
  if (marked) return marked.path;
  for (const name of SENT_FOLDER_NAMES) {
    const found = folders.find((f) => f.path.toLowerCase() === name.toLowerCase());
    if (found) return found.path;
  }
  return null;
}

/**
 * "Re:", "RE:", "Res:", "Re[2]:" at the start: the subject is already an answer.
 * The subject is the sender's: each run of spaces is read by exactly one `\s*`.
 * Two side by side (with the optional counter between them, say) split a run in
 * every possible way when there is no colon, and the work grows with the square
 * of its length (about a minute for 200,000 spaces).
 */
const REPLY_MARKER_RE = /^\s*res?\s*(?:\[\d+\]\s*)?:/i;
/** A message id as headers write it: `<`, anything but spaces and angle brackets, `>`. Whatever else a sender put there is dropped. */
const MESSAGE_ID_RE = /^<[^<>\s]+>$/;

/**
 * The subject and the threading headers of a reply to a received e-mail:
 * "Re: " once (not on a subject that already has one, nor in front of nothing),
 * In-Reply-To = the original's Message-ID and References = its chain plus that
 * id. Everything comes from the sender's headers, so a subject is cut to one
 * line and only well-formed `<id>` tokens are kept; an original with no usable
 * Message-ID has nothing to thread on, whatever its chain says.
 */
export function replyHeaders(original: { subject: string; messageId: string | null; references: string[] }): {
  subject: string;
  headers: Record<string, string>;
} {
  const line = original.subject.replace(/[\r\n]+/g, " ").trim();
  const subject = REPLY_MARKER_RE.test(line) ? line : line ? `Re: ${line}` : "Re:";
  const id = (original.messageId ?? "").trim();
  if (!MESSAGE_ID_RE.test(id)) return { subject, headers: {} };
  const chain = original.references.flatMap((r) => r.split(/\s+/)).filter((r) => MESSAGE_ID_RE.test(r));
  return { subject, headers: { "In-Reply-To": id, References: Array.from(new Set([...chain, id])).join(" ") } };
}

/**
 * Whether a reply went out. Only a network failure or a timeout while the
 * e-mail was being handed over (stage "send", no reply code) may have come after
 * the server took it: "uncertain", never sent again by itself. A server saying no,
 * or a failure before the content left, did not send it.
 */
export function replyOutcome(o: MailboxSendOutcome): "sent" | "uncertain" | "failed" {
  if (o.ok) return "sent";
  return o.stage === "send" && o.status === 0 ? "uncertain" : "failed";
}

/** The longest subject a reply carries: one line of a header, where the sender's own may be megabytes. */
export const REPLY_SUBJECT_MAX_CHARS = 250;
/**
 * The most ids of the chain a reply repeats in References, the newest ones (the last is the e-mail answered). A longer
 * header can get the reply refused (Postfix stops at 100 KB of headers), and the receiver has the older e-mails already.
 */
export const REPLY_REFERENCES_MAX = 25;
/** How much of the header block fetched from the server is read: a real References chain is a few KB, the sender's can be megabytes. */
export const THREAD_HEADERS_MAX_CHARS = 64 * 1024;

/** An id as a header writes it: `<`, printable ASCII but angle brackets and spaces, `>`. Nothing that could end a header line. */
const ID_TOKEN_RE = /<[\x21-\x3b\x3d\x3f-\x7e]{1,998}>/g;

/**
 * The Message-ID and the References chain out of the header block the server hands over for
 * `BODY[HEADER.FIELDS (MESSAGE-ID REFERENCES)]`: lines folded back into one, names in any case, and only the `<id>`
 * tokens of each value (a comment after an id, a stray word, anything that isn't an id is left out). The first
 * Message-ID wins and every References line adds to the chain, in order. Reads at most THREAD_HEADERS_MAX_CHARS.
 */
export function threadIdsFromHeaders(block: string): { messageId: string | null; references: string[] } {
  const lines = block.slice(0, THREAD_HEADERS_MAX_CHARS).replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  let messageId: string | null = null;
  const references: string[] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (name !== "message-id" && name !== "references") continue;
    const ids = line.slice(colon + 1).match(ID_TOKEN_RE) ?? [];
    if (name === "message-id") {
      messageId ??= ids[0] ?? null;
    } else {
      for (const id of ids) references.push(id);
    }
  }
  return { messageId, references };
}

/**
 * A plain mailbox: letters, digits and . _ + ' = - before the @ (no dot first, last or doubled), a dotted domain
 * after it (letters, digits and hyphens, a name in letters at the end, so an IP is not one). No quotes, brackets, spaces,
 * commas, colons or angle brackets: whatever the sender put in the header, nothing here can end the RCPT TO line, add a
 * recipient or ask a relay to route it.
 */
const REPLY_LOCAL_RE = /^[A-Za-z0-9_+'=-]+(?:\.[A-Za-z0-9_+'=-]+)*$/;
const REPLY_DOMAIN_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]{0,61}[A-Za-z0-9]$/;

function isPlainMailbox(address: string): boolean {
  // The lengths first: they bound the work the patterns do on a sender's text (RFC 5321: 64 before the @, 254 in all).
  if (address.length > 254) return false;
  const at = address.indexOf("@");
  if (at < 1 || at > 64 || address.indexOf("@", at + 1) !== -1) return false;
  return REPLY_LOCAL_RE.test(address.slice(0, at)) && REPLY_DOMAIN_RE.test(address.slice(at + 1));
}

/**
 * Who a reply goes to: the first plain mailbox (isPlainMailbox) among the Reply-To addresses and, when there is none,
 * among the From ones. Pass the lists in that order. The addresses come from the sender, so one that isn't plain is not
 * used (a sender can write anything in the header, an address that closes the RCPT TO line included), and a Reply-To
 * with nothing usable in it is as good as none. Null when no list has one. Returned as the sender wrote it.
 */
export function replyAddress(lists: readonly (readonly { address?: string | null }[] | undefined)[]): string | null {
  for (const list of lists) {
    for (const entry of list ?? []) {
      const address = (entry.address ?? "").trim();
      if (isPlainMailbox(address)) return address;
    }
  }
  return null;
}

/** `text` cut to at most `max` UTF-16 units without splitting an emoji, and without the blank the cut may leave at the end. */
function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

/**
 * replyHeaders for a reply that is really sent: the subject, which is the sender's own words, is made one short line
 * first (every control character a blank, runs of blanks one, at most REPLY_SUBJECT_MAX_CHARS with the "Re: "), and
 * the chain in References is cut to its newest REPLY_REFERENCES_MAX ids. replyHeaders keeps a subject's internal blanks
 * on purpose (its own tests pin that); a header that carries them, or carries megabytes, is not one to send.
 */
export function replyHeadersForSend(original: { subject: string; messageId: string | null; references: string[] }): {
  subject: string;
  headers: Record<string, string>;
} {
  const line = original.subject.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim();
  const { subject, headers } = replyHeaders({ ...original, subject: line });
  const chain = headers.References?.split(" ") ?? [];
  if (chain.length > REPLY_REFERENCES_MAX) headers.References = chain.slice(-REPLY_REFERENCES_MAX).join(" ");
  return { subject: cutText(subject, REPLY_SUBJECT_MAX_CHARS), headers };
}

/** A sender or recipient as the inbox shows it: trimmed, the address in lower case, a blank one as null. */
export function addressFromImap(name: string | null | undefined, address: string | null | undefined): InboxAddress {
  return { name: (name ?? "").trim() || null, email: (address ?? "").trim().toLowerCase() || null };
}

/** What the list needs of a message: its envelope and flags, never its body. */
export type ImapListItem = {
  uid: number;
  uidValidity: number;
  subject: string | null;
  from: { name?: string; address?: string }[];
  date: Date;
  seen: boolean;
  hasAttachments: boolean;
};

/**
 * A list row from an IMAP envelope. There is no preview (it would take the body
 * of every message). The sender is the first one with an address, and an
 * unreadable date becomes the epoch, so one malformed message never breaks the list.
 */
export function summaryFromImap(item: ImapListItem): InboxMessageSummary {
  const sender = item.from.find((a) => a.address) ?? item.from[0];
  return {
    id: imapMessageRef(item.uidValidity, item.uid),
    subject: (item.subject ?? "").trim(),
    from: addressFromImap(sender?.name, sender?.address),
    receivedAt: (Number.isNaN(item.date.getTime()) ? new Date(0) : item.date).toISOString(),
    isRead: item.seen,
    hasAttachments: item.hasAttachments,
    preview: "",
  };
}
