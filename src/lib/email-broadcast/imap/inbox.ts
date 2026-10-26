import "server-only";
import PostalMime, { type Attachment, type Email } from "postal-mime";
import type { FetchMessageObject, FetchQueryObject, ImapFlow, ImapFlowError, MailboxObject, SearchObject } from "imapflow";
import { normalizeSearch } from "@/lib/search-options";
import { tenantDb } from "@/lib/tenant-db";
import {
  INBOX_PAGE_SIZE,
  SEARCH_MAX_CHARS,
  inboxBodyDocument,
  type InboxAddress,
  type InboxMessageDetail,
  type InboxMessageSummary,
} from "../microsoft/inbox-core";
import type {
  InboxAttachmentDownload,
  InboxDetailResult,
  InboxView,
  MailboxFailure,
  MailboxResult,
} from "../microsoft/inbox";
import { openSmtpSettings } from "../smtp/credentials";
import { redactAndCut } from "../smtp/redact";
import { closeImap, openImap, type ImapAuth } from "./connect";
import { addressFromImap, isAttachmentIndex, parseImapMessageRef, summaryFromImap } from "./core";
import { IMAP_MAX_MESSAGE_BYTES, detailFromParsed, hasAttachmentsInStructure, listedAttachments } from "./parse";

/**
 * Reading the inbox of the company's SMTP account over IMAP (spec 2026-10-23),
 * returning what the Microsoft inbox returns (MailboxResult, InboxView) so one
 * screen shows both. Every call resolves the company's own account, opens one
 * connection, works in the INBOX and closes. The only thing it writes to the
 * mailbox is the \Seen mark of an e-mail the person opens; it never removes or
 * moves mail. The list never downloads a body; opening an e-mail downloads it
 * whole up to IMAP_MAX_MESSAGE_BYTES.
 */

const INBOX = "INBOX";
const SEEN = "\\Seen";
/** The whole request after the login: a server that answers a byte at a time is cut off here (the socket timer doesn't catch that). */
const IMAP_REQUEST_BUDGET_MS = 60_000;

/** Shared by every call, so frozen: no caller can change what the next one gets. */
const NOT_FOUND: MailboxFailure = Object.freeze({ ok: false, reason: "not_found" } as const);
const TEMPORARY: MailboxFailure = Object.freeze({ ok: false, reason: "temporary" } as const);

const MAX_MESSAGE_MB = IMAP_MAX_MESSAGE_BYTES / (1024 * 1024);
/** In the body pane of an e-mail that is not opened here. There is no locale at this depth, so it says it in both languages. */
const TOO_BIG_NOTICE =
  `Este e-mail tem mais de ${MAX_MESSAGE_MB} MB e não é aberto aqui. Abra-o no webmail da sua caixa.\n\n` +
  `This e-mail is over ${MAX_MESSAGE_MB} MB and is not opened here. Open it in your mailbox's webmail.`;
const UNREADABLE_NOTICE =
  "Não foi possível mostrar este e-mail aqui. Abra-o no webmail da sua caixa.\n\n" +
  "This e-mail can't be shown here. Open it in your mailbox's webmail.";

const BASE_QUERY: FetchQueryObject = { uid: true, flags: true, envelope: true, internalDate: true };
/** What the list needs of each message: envelope, flags, internal date and body structure; never a body. */
const LIST_QUERY: FetchQueryObject = { ...BASE_QUERY, bodyStructure: true };
/** The same plus the size, for the e-mail being opened: the size decides whether it is downloaded. */
const OPEN_QUERY: FetchQueryObject = { ...LIST_QUERY, size: true };
/** The opened e-mail's query less the body structure: for one whose structure imapflow can't read (see fetchListRows). */
const OPEN_QUERY_FLAT: FetchQueryObject = { ...BASE_QUERY, size: true };

/** One line about a failure for the log: imapflow's code and words, the login's secrets out, short. */
function failureText(e: unknown, auth: ImapAuth): string {
  const err = (typeof e === "object" && e !== null ? e : { message: String(e) }) as ImapFlowError;
  const words = [err.code, err.message].filter((part) => typeof part === "string" && part !== "").join(": ");
  return redactAndCut(words || "unknown error", { username: auth.user, password: auth.pass }, 300)
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuts a connection without a goodbye. Never throws. */
function cut(client: ImapFlow): void {
  try {
    client.close();
  } catch {
    // already closed
  }
}

/**
 * Runs `run` on a connection to the company's mailbox, logged in and closed
 * again whatever happens. The account is the company's own (tenantDb): none, or
 * one that doesn't read an inbox, is "no_account"; one that was disconnected,
 * whose credentials no longer open or whose login the server refuses is
 * "reconnect"; any other trouble is "temporary" and is logged without the
 * password. Nothing here marks the account NEEDS_RECONNECT: it is also the
 * company's sending account, and a read that fails must not pause its sends.
 */
async function withImap<T>(
  organizationId: string,
  run: (client: ImapFlow) => Promise<MailboxResult<T>>,
): Promise<MailboxResult<T>> {
  // Filter by provider: a company may connect one account of each.
  const account = await tenantDb(organizationId).emailSenderAccount.findFirst({
    where: { provider: "SMTP" },
    select: { status: true, credentials: true },
  });
  if (!account) return { ok: false, reason: "no_account" };
  const settings = openSmtpSettings(account.credentials);
  // An account whose credentials no longer open needs the form again; one that never had an inbox has none to read.
  if (!settings) return { ok: false, reason: "reconnect" };
  if (!settings.imap) return { ok: false, reason: "no_account" };
  if (account.status !== "ACTIVE") return { ok: false, reason: "reconnect" };

  const auth: ImapAuth = { user: settings.username, pass: settings.password };
  const opened = await openImap(settings.imap, auth);
  if (!opened.ok) {
    // A refused login is the expected way for a changed password to show up, and is not worth a log line each time.
    if (opened.error === "auth_failed") return { ok: false, reason: "reconnect" };
    console.error("IMAP inbox connection failed", opened.error, opened.technical);
    return TEMPORARY;
  }

  const { client } = opened;
  const budget = setTimeout(() => cut(client), IMAP_REQUEST_BUDGET_MS);
  try {
    return await run(client);
  } catch (e) {
    console.error("IMAP inbox failed", failureText(e, auth));
    return TEMPORARY;
  } finally {
    clearTimeout(budget);
    await closeImap(client);
  }
}

/** `run` inside the INBOX, opened read and write (opening an e-mail marks it read) and let go of at the end. */
function withInbox<T>(
  organizationId: string,
  run: (client: ImapFlow, mailbox: MailboxObject) => Promise<MailboxResult<T>>,
): Promise<MailboxResult<T>> {
  return withImap(organizationId, async (client) => {
    const lock = await client.getMailboxLock(INBOX);
    try {
      const mailbox = client.mailbox;
      if (!mailbox) return TEMPORARY;
      return await run(client, mailbox);
    } finally {
      lock.release();
    }
  });
}

/** The search text as it goes to the server: control characters (a line break would end the command) are spaces, spaces collapse, capped. */
function cleanSearch(text: string): string {
  return text.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_CHARS);
}

/**
 * What to ask the server for. A text search is TEXT (headers and body), and for
 * a text with accents the same without them as well: a server whose index drops
 * accents finds "promocao" and not "promoção" (Ethereal), one that keeps them
 * finds the reverse (Dovecot), and the person types either way.
 */
function searchQuery(filter: { search: string; unreadOnly: boolean }): SearchObject {
  const query: SearchObject = {};
  if (filter.unreadOnly) query.seen = false;
  if (filter.search) {
    const folded = normalizeSearch(filter.search);
    // (Nothing left after the accents: a TEXT of nothing would match every e-mail.)
    if (!folded || folded === filter.search.toLowerCase()) query.text = filter.search;
    else query.or = [{ text: filter.search }, { text: folded }];
  }
  return query;
}

/** A search the server refused or imapflow wouldn't build: the text is the problem, not the connection. */
function searchRejected(e: unknown): boolean {
  const err = (typeof e === "object" && e !== null ? e : {}) as ImapFlowError;
  return err.responseStatus === "NO" || err.responseStatus === "BAD" || err.code === "InvalidSearchQuery";
}

/**
 * FETCH of the list rows for `range`, which should name the e-mails in `expected`
 * (UIDs when `byUid`, else sequence numbers). imapflow reads at most 25 levels of
 * nesting in a server's answer and drops, without a word, the answer that goes
 * deeper: an e-mail whose body structure is that deep (a sender can make one on
 * purpose, and a server may report it as it is) would vanish from the page.
 * Whatever `expected` names and didn't come back is asked for once more without
 * the structure and shows with no attachment mark. Exported for check:imap.
 */
export async function fetchListRows(
  client: ImapFlow,
  range: string,
  expected: { byUid: boolean; ids: number[] },
): Promise<FetchMessageObject[]> {
  const options = { uid: expected.byUid };
  const rows = await client.fetchAll(range, LIST_QUERY, options);
  const have = new Set(rows.map((row) => (expected.byUid ? row.uid : row.seq)));
  const missing = expected.ids.filter((id) => !have.has(id));
  if (missing.length > 0) {
    try {
      rows.push(...(await client.fetchAll(missing.join(","), BASE_QUERY, options)));
    } catch {
      // What was asked for may be gone since (someone deleted it): the page goes on without it.
    }
  }
  return rows;
}

/**
 * The newest INBOX_PAGE_SIZE e-mails, newest first. Without a filter these are
 * the last sequence numbers; with one, the server searches (UIDs) and the
 * newest of what it finds are fetched. An empty Inbox has no `1:*` to ask for.
 */
async function listNewest(
  client: ImapFlow,
  mailbox: MailboxObject,
  filter: { search: string; unreadOnly: boolean },
): Promise<FetchMessageObject[]> {
  let found: FetchMessageObject[];
  if (!filter.search && !filter.unreadOnly) {
    if (mailbox.exists === 0) return [];
    const first = Math.max(1, mailbox.exists - (INBOX_PAGE_SIZE - 1));
    const ids = Array.from({ length: mailbox.exists - first + 1 }, (_, i) => first + i);
    found = await fetchListRows(client, `${first}:*`, { byUid: false, ids });
  } else {
    const uids = await client.search(searchQuery(filter), { uid: true });
    const newest = (Array.isArray(uids) ? uids : []).sort((a, b) => b - a).slice(0, INBOX_PAGE_SIZE);
    if (newest.length === 0) return [];
    found = await fetchListRows(client, newest.join(","), { byUid: true, ids: newest });
  }
  return found.sort((a, b) => b.uid - a.uid).slice(0, INBOX_PAGE_SIZE);
}

/** A list row from what the server sent: the date is the delivery (INTERNALDATE), never the header the sender wrote. */
function summaryOf(m: FetchMessageObject, uidValidity: number): InboxMessageSummary {
  return summaryFromImap({
    uid: m.uid,
    uidValidity,
    subject: m.envelope?.subject ?? null,
    from: m.envelope?.from ?? [],
    date: new Date(m.internalDate ?? 0),
    seen: m.flags?.has(SEEN) ?? false,
    hasAttachments: hasAttachmentsInStructure(m.bodyStructure),
  });
}

/** Addresses of an envelope as the pane shows them. */
function envelopeAddresses(list: { name?: string; address?: string }[] | undefined): InboxAddress[] {
  return (list ?? []).map((a) => addressFromImap(a.name, a.address)).filter((a) => a.email || a.name);
}

/** An e-mail that isn't read whole: what the envelope says, and a notice in place of the body. */
function headersOnly(summary: InboxMessageSummary, m: FetchMessageObject, notice: string): InboxMessageDetail {
  return {
    ...summary,
    to: envelopeAddresses(m.envelope?.to),
    cc: envelopeAddresses(m.envelope?.cc),
    bodyDocument: inboxBodyDocument({ contentType: "text", content: notice }),
    webLink: null,
    attachments: [],
  };
}

type ParsedSource = { ok: true; email: Email } | { ok: false; why: "gone" | "unreadable" };

/** Downloads the e-mail whole (the caller has checked its size) and parses it. A parse that fails is logged and is "unreadable". */
async function readParsed(client: ImapFlow, uid: number): Promise<ParsedSource> {
  const full = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
  if (!full || !full.source) return { ok: false, why: "gone" };
  try {
    return { ok: true, email: await PostalMime.parse(full.source) };
  } catch (e) {
    console.error("IMAP message could not be parsed:", e instanceof Error ? e.message.slice(0, 200) : "unknown error");
    return { ok: false, why: "unreadable" };
  }
}

/**
 * The e-mail as the reading pane shows it. One FETCH says what it is and how
 * big; only up to `maxBytes` is downloaded and parsed, anything else (or a
 * message the parser refuses) shows its envelope and a notice. Exported for
 * check:imap, which runs it against a server of its own.
 */
export async function openMessage(
  client: ImapFlow,
  uidValidity: number,
  uid: number,
  maxBytes: number,
): Promise<InboxDetailResult> {
  // An e-mail whose body structure is too deep for imapflow comes back empty (see fetchListRows): ask again without it.
  const meta =
    (await client.fetchOne(String(uid), OPEN_QUERY, { uid: true })) ||
    (await client.fetchOne(String(uid), OPEN_QUERY_FLAT, { uid: true }));
  if (!meta) return { ok: false, reason: "not_found" };
  const summary = summaryOf(meta, uidValidity);
  if (meta.size === undefined || meta.size > maxBytes) {
    return { ok: true, data: headersOnly(summary, meta, TOO_BIG_NOTICE) };
  }
  const parsed = await readParsed(client, uid);
  if (parsed.ok) return { ok: true, data: detailFromParsed(summary, parsed.email) };
  if (parsed.why === "gone") return { ok: false, reason: "not_found" };
  return { ok: true, data: headersOnly(summary, meta, UNREADABLE_NOTICE) };
}

/** \Seen on an e-mail, the one write the inbox makes. True when the server took it; a failure only means it stays unread. */
async function markSeen(client: ImapFlow, uid: number): Promise<boolean> {
  try {
    return (await client.messageFlagsAdd(String(uid), [SEEN], { uid: true })) === true;
  } catch {
    return false;
  }
}

/**
 * The Inbox tab over IMAP: the newest INBOX_PAGE_SIZE e-mails and, when an
 * e-mail is open, that e-mail (null otherwise), under one connection.
 *
 * `unreadOnly` and a search are asked of the server (a search is TEXT; see
 * searchQuery) and come back newest first. Opening an unread e-mail marks it
 * read in the mailbox, as the Microsoft inbox does, and the returned page
 * already shows it read and counts one unread less. An id from another
 * numbering of the mailbox (UIDVALIDITY), or for an e-mail that is gone, only
 * fails `detail`; a search the server refuses fails the view as "not_found",
 * which the screen words as "try other words". `maxMessageBytes` is the size
 * above which an e-mail is not downloaded, IMAP_MAX_MESSAGE_BYTES unless a
 * check lowers it to reach that path without moving 15 MB.
 */
export function loadImapInboxView(
  organizationId: string,
  opts: { search: string; unreadOnly: boolean; messageId: string | null; maxMessageBytes?: number },
): Promise<MailboxResult<InboxView>> {
  const search = cleanSearch(opts.search);
  const maxBytes = opts.maxMessageBytes ?? IMAP_MAX_MESSAGE_BYTES;
  return withInbox<InboxView>(organizationId, async (client, mailbox) => {
    const uidValidity = Number(mailbox.uidValidity);
    const status = await client.status(INBOX, { unseen: true });
    let unreadCount = status ? (status.unseen ?? 0) : 0;

    let listed: FetchMessageObject[];
    try {
      listed = await listNewest(client, mailbox, { search, unreadOnly: opts.unreadOnly });
    } catch (e) {
      if (search && searchRejected(e)) return NOT_FOUND;
      throw e;
    }
    let messages = listed.map((m) => summaryOf(m, uidValidity));

    let detail: InboxDetailResult | null = null;
    if (opts.messageId !== null) {
      const ref = parseImapMessageRef(opts.messageId);
      detail =
        ref && ref.uidValidity === uidValidity
          ? await openMessage(client, uidValidity, ref.uid, maxBytes)
          : { ok: false, reason: "not_found" };
      if (ref && detail.ok && !detail.data.isRead && (await markSeen(client, ref.uid))) {
        const opened = detail.data;
        opened.isRead = true;
        messages = messages.map((m) => (m.id === opened.id ? { ...m, isRead: true } : m));
        unreadCount = Math.max(0, unreadCount - 1);
      }
    }

    return { ok: true, data: { page: { messages, unreadCount }, detail } };
  });
}

/** Unread e-mails in the Inbox, for the channel card and the tab. Null when it can't be read now. */
export async function imapUnreadCount(organizationId: string): Promise<number | null> {
  const res = await withImap<number>(organizationId, async (client) => {
    const status = await client.status(INBOX, { unseen: true });
    return status ? { ok: true, data: status.unseen ?? 0 } : TEMPORARY;
  });
  return res.ok ? res.data : null;
}

/** The attachment's bytes, whichever form postal-mime handed them over in (it depends on `attachmentEncoding`). */
function attachmentBytes(a: Attachment): Uint8Array {
  const c = a.content;
  if (typeof c === "string") return Buffer.from(c, a.encoding === "base64" ? "base64" : "utf8");
  return c instanceof Uint8Array ? c : new Uint8Array(c);
}

/** The bytes as the body the download route sends (InboxAttachmentDownload.body is a stream, as the Microsoft one's is). */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * One attachment of an Inbox e-mail: the e-mail is downloaded whole and parsed
 * (up to IMAP_MAX_MESSAGE_BYTES, as when it is opened) and the file is the one
 * whose id the opened e-mail listed. That list leaves out the images the body
 * shows itself, so an id outside it (or any id of an e-mail that is too big to
 * be read) is "not_found", and so is an id from another numbering of the
 * mailbox. The bytes are in memory, as the 15 MB cap allows
 * (`maxMessageBytes`, as in loadImapInboxView).
 */
export function downloadImapAttachment(
  organizationId: string,
  messageId: string,
  index: string,
  maxMessageBytes: number = IMAP_MAX_MESSAGE_BYTES,
): Promise<MailboxResult<InboxAttachmentDownload>> {
  const ref = parseImapMessageRef(messageId);
  if (!ref || !isAttachmentIndex(index)) return Promise.resolve(NOT_FOUND);
  return withInbox<InboxAttachmentDownload>(organizationId, async (client, mailbox) => {
    if (ref.uidValidity !== Number(mailbox.uidValidity)) return NOT_FOUND;
    const meta = await client.fetchOne(String(ref.uid), { uid: true, size: true }, { uid: true });
    if (!meta || meta.size === undefined || meta.size > maxMessageBytes) return NOT_FOUND;
    const parsed = await readParsed(client, ref.uid);
    if (!parsed.ok) return NOT_FOUND;
    // The id is the index the list gave, in the spelling the list gave it.
    const listed = listedAttachments(parsed.email).find((l) => String(l.index) === index);
    if (!listed) return NOT_FOUND;
    const bytes = attachmentBytes(listed.attachment);
    return {
      ok: true,
      data: { name: (listed.attachment.filename ?? "").trim() || "anexo", body: streamOf(bytes), size: bytes.byteLength },
    };
  });
}
