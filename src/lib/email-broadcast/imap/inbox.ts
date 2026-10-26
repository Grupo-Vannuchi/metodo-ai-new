import "server-only";
import PostalMime, { type Attachment, type Email } from "postal-mime";
import type {
  FetchMessageObject,
  FetchQueryObject,
  ImapFlow,
  ImapFlowError,
  MailboxObject,
  MessageEnvelopeObject,
  SearchObject,
} from "imapflow";
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
import { markNeedsReconnect } from "../mailbox/token";
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
 *
 * The server is not trusted. connect.ts bounds each answer it sends; what a
 * whole request may take in is bounded here: withImap watches its time and its
 * bytes, and the FETCH rows are read one at a time, kept only if asked for and
 * counted (gatherRows). And imapflow turns most failures into a quiet `false`,
 * `undefined` or `[]`, so the code below never takes such an answer for the
 * server's: a lost connection is "temporary", never an empty inbox.
 */

const INBOX = "INBOX";
const SEEN = "\\Seen";
/** The whole request after the login: a server that answers a byte at a time is cut off here (the socket timer doesn't catch that). */
const IMAP_REQUEST_BUDGET_MS = 60_000;
/** The most one request takes in from the server: the biggest e-mail it reads whole, and room for the lists and the protocol around it. */
const IMAP_MAX_REQUEST_BYTES = IMAP_MAX_MESSAGE_BYTES + 8 * 1024 * 1024;
/** How often a request looks at its clock and at what it has received. */
const IMAP_GUARD_TICK_MS = 100;

/**
 * How a request reaches the server and what it may cost: fixed in production. check:imap swaps these to run this code
 * against a server of its own on loopback (openImap refuses internal addresses on purpose), to count the connections a
 * request makes, and to reach the budget and the byte cap in a fraction of a second.
 */
export const imapRequest = {
  open: openImap,
  budgetMs: IMAP_REQUEST_BUDGET_MS,
  maxReceivedBytes: IMAP_MAX_REQUEST_BYTES,
};

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
const SIZE_QUERY: FetchQueryObject = { uid: true, size: true };
const SOURCE_QUERY: FetchQueryObject = { uid: true, source: true };

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

/** The server said NO or BAD to a command (and the connection went on), as opposed to a connection that was lost. */
function refusedByServer(client: ImapFlow, e: unknown): boolean {
  const err = (typeof e === "object" && e !== null ? e : {}) as ImapFlowError;
  return client.usable && (err.responseStatus === "NO" || err.responseStatus === "BAD");
}

/**
 * Reply codes (RFC 5530) of a login the server refuses without a word against the credentials: it is in trouble
 * (UNAVAILABLE) or has too many connections of this person open (LIMIT, INUSE). imapflow calls every tagged NO or BAD
 * of a login "authentication failed", these included, and trying again later fixes them. openImap's `technical` text
 * starts with the code when the server sent one.
 */
const LOGIN_REFUSED_FOR_NOW = /^(UNAVAILABLE|LIMIT|INUSE)\b/;

/**
 * The server refused the login: the account is paused (NEEDS_RECONNECT), the way a refused token pauses the other
 * providers' accounts. The next requests then answer "reconnect" without dialing, instead of trying the same password on
 * every page view: a provider that throttles failed logins could close its door to the platform's address, for every
 * company it serves. This is also the company's sending account, so its sends pause until the form saves it again,
 * which is why a refusal that isn't about the credentials (LOGIN_REFUSED_FOR_NOW) doesn't get here.
 * Failing to say so must not hide the answer: the person still has to reconnect.
 */
async function pauseAccount(organizationId: string, accountId: string, technical: string): Promise<void> {
  try {
    await markNeedsReconnect(organizationId, accountId, `imap login refused: ${technical}`);
  } catch (e) {
    console.error("IMAP account could not be paused:", e instanceof Error ? e.message.slice(0, 200) : "unknown error");
  }
}

/**
 * Runs `run` on a connection to the company's mailbox, logged in and closed
 * again whatever happens. The account is the company's own (tenantDb): none, or
 * one that doesn't read an inbox, is "no_account"; one that was disconnected,
 * whose credentials no longer open or whose login the server refuses is
 * "reconnect" (a refused login also pauses the account, see pauseAccount); any
 * other trouble, a login refused only for now included, is "temporary" and is
 * logged without the password.
 *
 * A request is watched while it runs (imapRequest): past its time or the bytes it
 * may take in, the connection is cut. A cut or lost connection makes imapflow
 * answer search() and status() with `false` and the FETCH calls with nothing,
 * instead of an error, so once `run` is done a connection that is no longer usable
 * turns whatever it came to into "temporary": never an empty inbox, a "no
 * results" or a 404.
 */
async function withImap<T>(
  organizationId: string,
  run: (client: ImapFlow) => Promise<MailboxResult<T>>,
): Promise<MailboxResult<T>> {
  // Filter by provider: a company may connect one account of each.
  const account = await tenantDb(organizationId).emailSenderAccount.findFirst({
    where: { provider: "SMTP" },
    select: { id: true, status: true, credentials: true },
  });
  if (!account) return { ok: false, reason: "no_account" };
  const settings = openSmtpSettings(account.credentials);
  // An account whose credentials no longer open needs the form again; one that never had an inbox has none to read.
  if (!settings) return { ok: false, reason: "reconnect" };
  if (!settings.imap) return { ok: false, reason: "no_account" };
  if (account.status !== "ACTIVE") return { ok: false, reason: "reconnect" };

  const auth: ImapAuth = { user: settings.username, pass: settings.password };
  const opened = await imapRequest.open(settings.imap, auth);
  if (!opened.ok) {
    if (opened.error === "auth_failed" && !LOGIN_REFUSED_FOR_NOW.test(opened.technical)) {
      await pauseAccount(organizationId, account.id, opened.technical);
      return { ok: false, reason: "reconnect" };
    }
    console.error("IMAP inbox connection failed", opened.error, opened.technical);
    return TEMPORARY;
  }

  const { client } = opened;
  const watch: { startedAt: number; cutFor: string | null } = { startedAt: Date.now(), cutFor: null };
  const guard = setInterval(() => {
    if (Date.now() - watch.startedAt > imapRequest.budgetMs) {
      watch.cutFor = `it took more than ${imapRequest.budgetMs / 1000} s`;
    } else if (client.stats().received > imapRequest.maxReceivedBytes) {
      watch.cutFor = `it took in more than ${imapRequest.maxReceivedBytes} bytes`;
    }
    if (watch.cutFor !== null) {
      clearInterval(guard);
      cut(client);
    }
  }, IMAP_GUARD_TICK_MS);
  try {
    const result = await run(client);
    if (watch.cutFor !== null || !client.usable) {
      console.error(watch.cutFor !== null ? `IMAP request cut: ${watch.cutFor}` : "IMAP request lost its connection");
      return TEMPORARY;
    }
    return result;
  } catch (e) {
    console.error(watch.cutFor !== null ? `IMAP request cut: ${watch.cutFor}` : "IMAP inbox failed", failureText(e, auth));
    return TEMPORARY;
  } finally {
    clearInterval(guard);
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

/**
 * The UIDs the server finds, or null when it refused the search. imapflow's search()
 * answers `false` (`undefined` with no mailbox) to every failure alike, a server's NO or
 * BAD and a lost connection: only a connection that is still usable says the server
 * refused. A query imapflow can't build throws before anything is sent; that is the
 * text's fault too. A lost connection is neither: it throws.
 */
async function searchUids(client: ImapFlow, query: SearchObject): Promise<number[] | null> {
  let found: Awaited<ReturnType<ImapFlow["search"]>>;
  try {
    found = await client.search(query, { uid: true });
  } catch (e) {
    if (client.usable) return null;
    throw e;
  }
  if (Array.isArray(found)) return found;
  if (client.usable) return null;
  throw new Error("The connection was lost during the search");
}

/**
 * What is kept of a FETCH row: the fields the query asked for and nothing else, and the
 * body structure (which can weigh many times the bytes it came in) reduced to the one
 * thing it is read for. A hostile server can hang anything on a row, a 16 MB literal
 * included, and imapflow hands it all over.
 */
type Row = Partial<Omit<FetchMessageObject, "bodyStructure">> & { hasAttachments?: boolean };
/** A row with what the pane needs to show an e-mail. */
type ListRow = Row & { uid: number; envelope: MessageEnvelopeObject };

function isListRow(row: Row | null | undefined): row is ListRow {
  return row?.uid !== undefined && row.envelope !== undefined;
}

function keepAsked(row: FetchMessageObject, query: FetchQueryObject): Row {
  const kept: Row = {};
  if (row.seq !== undefined) kept.seq = row.seq;
  if (row.uid !== undefined) kept.uid = row.uid;
  if (query.flags && row.flags) kept.flags = row.flags;
  if (query.envelope && row.envelope) kept.envelope = row.envelope;
  if (query.internalDate && row.internalDate !== undefined) kept.internalDate = row.internalDate;
  if (query.size && row.size !== undefined) kept.size = row.size;
  if (query.source && row.source) kept.source = row.source;
  if (query.bodyStructure && row.bodyStructure) kept.hasAttachments = hasAttachmentsInStructure(row.bodyStructure);
  return kept;
}

/**
 * A FETCH of `range`, which names the e-mails in `expected` (UIDs when `byUid`, else
 * sequence numbers), read through imapflow's generator: one row at a time, the server held
 * back until this loop asks for the next. fetchAll() and fetchOne() keep every row that
 * arrives during the command, asked for or not, and the answer limits start over after each
 * row: a server could stream rows into gigabytes (about 47,000 a second were measured) with
 * the time budget as the only stop. Here a row nobody asked for is dropped, a second row
 * for the same e-mail is merged into the first (servers may split an answer), and once the
 * server has sent more rows than any real answer carries (twice what was asked, and ten) the
 * connection is cut and this throws.
 */
async function gatherRows(
  client: ImapFlow,
  range: string,
  query: FetchQueryObject,
  expected: { byUid: boolean; ids: number[] },
): Promise<Map<number, Row>> {
  const wanted = new Set(expected.ids);
  const limit = expected.ids.length * 2 + 10;
  const rows = new Map<number, Row>();
  let received = 0;
  for await (const row of client.fetch(range, query, { uid: expected.byUid })) {
    if (++received > limit) {
      cut(client);
      throw new Error(`The server sent more than ${limit} FETCH answers for ${expected.ids.length} e-mail(s)`);
    }
    const id = expected.byUid ? row.uid : row.seq;
    if (!wanted.has(id)) continue;
    rows.set(id, { ...rows.get(id), ...keepAsked(row, query) });
  }
  return rows;
}

/** One e-mail's row, read the way gatherRows reads (so with its limits). Null when the server sent none for it. */
async function fetchOneRow(client: ImapFlow, uid: number, query: FetchQueryObject): Promise<Row | null> {
  const rows = await gatherRows(client, String(uid), query, { byUid: true, ids: [uid] });
  return rows.get(uid) ?? null;
}

/**
 * The list rows for `range`, which names the e-mails in `expected`; the rows that came back
 * complete (UID and envelope). imapflow reads at most 25 levels of nesting in a server's
 * answer and drops, without a word, the answer that goes deeper: an e-mail whose body
 * structure is that deep (a sender can make one on purpose, and a server may report it as it
 * is) would vanish from the page. Whatever `expected` names and didn't come back complete is
 * asked for once more without the structure and shows with no attachment mark. Exported for
 * check:imap.
 */
export async function fetchListRows(
  client: ImapFlow,
  range: string,
  expected: { byUid: boolean; ids: number[] },
): Promise<ListRow[]> {
  const rows = await gatherRows(client, range, LIST_QUERY, expected);
  const missing = expected.ids.filter((id) => !isListRow(rows.get(id)));
  if (missing.length > 0) {
    try {
      const again = await gatherRows(client, missing.join(","), BASE_QUERY, { byUid: expected.byUid, ids: missing });
      for (const [id, row] of again) rows.set(id, { ...rows.get(id), ...row });
    } catch (e) {
      // What was asked for may be gone since (someone removed it, the server says no): the page goes on without it. A lost
      // connection, or a server cut off for sending too much, is not that.
      if (!refusedByServer(client, e)) throw e;
    }
  }
  return [...rows.values()].filter(isListRow);
}

/**
 * The newest INBOX_PAGE_SIZE e-mails, newest first. Without a filter these are
 * the last sequence numbers; with one, the server searches (UIDs) and the
 * newest of what it finds are fetched. An empty Inbox has no `1:*` to ask for.
 * Null when the server refused the search.
 */
async function listNewest(
  client: ImapFlow,
  mailbox: MailboxObject,
  filter: { search: string; unreadOnly: boolean },
): Promise<ListRow[] | null> {
  let found: ListRow[];
  if (!filter.search && !filter.unreadOnly) {
    if (mailbox.exists === 0) return [];
    const first = Math.max(1, mailbox.exists - (INBOX_PAGE_SIZE - 1));
    const ids = Array.from({ length: mailbox.exists - first + 1 }, (_, i) => first + i);
    found = await fetchListRows(client, `${first}:*`, { byUid: false, ids });
  } else {
    const uids = await searchUids(client, searchQuery(filter));
    if (uids === null) return null;
    const newest = uids.sort((a, b) => b - a).slice(0, INBOX_PAGE_SIZE);
    if (newest.length === 0) return [];
    found = await fetchListRows(client, newest.join(","), { byUid: true, ids: newest });
  }
  return found.sort((a, b) => b.uid - a.uid).slice(0, INBOX_PAGE_SIZE);
}

/** A list row from what the server sent: the date is the delivery (INTERNALDATE), never the header the sender wrote. */
function summaryOf(m: ListRow, uidValidity: number): InboxMessageSummary {
  return summaryFromImap({
    uid: m.uid,
    uidValidity,
    subject: m.envelope.subject ?? null,
    from: m.envelope.from ?? [],
    date: new Date(m.internalDate ?? 0),
    seen: m.flags?.has(SEEN) ?? false,
    hasAttachments: m.hasAttachments ?? false,
  });
}

/** Addresses of an envelope as the pane shows them. */
function envelopeAddresses(list: { name?: string; address?: string }[] | undefined): InboxAddress[] {
  return (list ?? []).map((a) => addressFromImap(a.name, a.address)).filter((a) => a.email || a.name);
}

/** An e-mail that isn't read whole: what the envelope says, and a notice in place of the body. */
function headersOnly(summary: InboxMessageSummary, m: ListRow, notice: string): InboxMessageDetail {
  return {
    ...summary,
    to: envelopeAddresses(m.envelope.to),
    cc: envelopeAddresses(m.envelope.cc),
    bodyDocument: inboxBodyDocument({ contentType: "text", content: notice }),
    webLink: null,
    attachments: [],
  };
}

type ParsedSource = { ok: true; email: Email } | { ok: false; why: "gone" | "unreadable" };

/** Downloads the e-mail whole (the caller has checked its size) and parses it. A parse that fails is logged and is "unreadable". */
async function readParsed(client: ImapFlow, uid: number): Promise<ParsedSource> {
  const full = await fetchOneRow(client, uid, SOURCE_QUERY);
  if (!full?.source) return { ok: false, why: "gone" };
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
  let meta = await fetchOneRow(client, uid, OPEN_QUERY);
  // An e-mail whose body structure is too deep for imapflow comes back empty (see fetchListRows): ask again without it.
  if (!isListRow(meta)) meta = await fetchOneRow(client, uid, OPEN_QUERY_FLAT);
  if (!isListRow(meta)) return { ok: false, reason: "not_found" };
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
 * fails `detail`. A search the server refuses (NO or BAD, or a query it can't
 * take) fails the view as "not_found", which the screen words as "try other
 * words"; a count or a list it refuses, or a connection lost on the way, is
 * "temporary". `maxMessageBytes` is the size above which an e-mail is not
 * downloaded, IMAP_MAX_MESSAGE_BYTES unless a check lowers it to reach that
 * path without moving 15 MB.
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
    // Like search(), status() answers `false` to a failure: a count nobody got is not a zero.
    if (!status) return TEMPORARY;
    let unreadCount = status.unseen ?? 0;

    const listed = await listNewest(client, mailbox, { search, unreadOnly: opts.unreadOnly });
    if (listed === null) return NOT_FOUND;
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
    const meta = await fetchOneRow(client, ref.uid, SIZE_QUERY);
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
