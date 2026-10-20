import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { GRAPH, graphCall, graphGetStream, type GraphFailure, type GraphResult } from "./graph";
import { getMicrosoftAccessToken, markNeedsReconnect } from "./token";
import {
  INBOX_PAGE_SIZE,
  addressesFromGraph,
  attachmentsFromGraph,
  graphSearchValue,
  inboxBodyDocument,
  isGraphId,
  replaceCidImages,
  summaryFromGraph,
  type InboxMessageDetail,
  type InboxMessageSummary,
} from "./inbox-core";

/**
 * Reading and answering the connected Microsoft mailbox's inbox. Every call
 * resolves the org's account, gets a token (renewed once on a 401) and only
 * touches messages that sit in the Inbox folder. Outlook takes about 4
 * concurrent requests per app and mailbox (more answer 429
 * "MailboxConcurrency"), so nothing here runs more than 3 Graph calls at once.
 */

export type MailboxFailure = { ok: false; reason: "no_account" | "reconnect" | "temporary" | "not_found" };
export type MailboxResult<T> = { ok: true; data: T } | MailboxFailure;

const SUMMARY_SELECT = "id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview";
const DETAIL_SELECT = `${SUMMARY_SELECT},toRecipients,ccRecipients,body,webLink,parentFolderId`;
/** Inline images turned into data URIs: at most this many, each up to this size, all within this time. */
const INLINE_IMAGES_MAX = 10;
const INLINE_IMAGE_MAX_BYTES = 1_500_000;
/** All inline images of one e-mail together (the page carries them twice: HTML and RSC payload). */
const INLINE_IMAGES_TOTAL_BYTES = 4_000_000;
const INLINE_IMAGES_BUDGET_MS = 15_000;
/** One 429 is waited out: Microsoft's Retry-After (seconds), capped; the default when it sends none. */
const THROTTLE_WAIT_MAX_S = 5;
const THROTTLE_WAIT_DEFAULT_S = 2;
/** `cid:` references of an HTML body, read as replaceCidImages reads them. */
const CID_RE = /cid:([^"'\s)>]+)/gi;

const msgUrl = (id: string) => `${GRAPH}/me/messages/${encodeURIComponent(id)}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Mailbox = {
  accountId: string;
  token: string;
  /** A 429 was already waited out: another one fails the call instead of being retried. */
  throttled: boolean;
};

/**
 * Run Graph calls against the org's mailbox, under one token. When `run`
 * answers 401 it runs once more with a renewed token; a second 401 means
 * Microsoft no longer accepts the consent: the account goes to
 * NEEDS_RECONNECT, as the dispatcher does. A 429 is waited out once
 * (Retry-After, at most THROTTLE_WAIT_MAX_S) and `run` goes again.
 */
async function withMailbox<T>(
  organizationId: string,
  run: (box: Mailbox) => Promise<GraphResult<T> | MailboxResult<T>>,
): Promise<MailboxResult<T>> {
  // Filter by provider: once other providers exist, a company may connect one of each.
  const account = await tenantDb(organizationId).emailSenderAccount.findFirst({
    where: { provider: "MICROSOFT" },
    select: { id: true, status: true },
  });
  if (!account) return { ok: false, reason: "no_account" };
  if (account.status !== "ACTIVE") return { ok: false, reason: "reconnect" };

  let token = await getMicrosoftAccessToken(organizationId, account.id);
  let refreshed = false;
  let throttled = false;
  // Each retry spends a flag, so this runs `run` at most 3 times.
  for (;;) {
    if (!token.ok) return { ok: false, reason: token.reason };
    const res = await run({ accountId: account.id, token: token.accessToken, throttled });
    if (res.ok) return { ok: true, data: res.data };
    if ("reason" in res) return res;
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      token = await getMicrosoftAccessToken(organizationId, account.id, { force: true });
      continue;
    }
    if (res.status === 401) {
      await markNeedsReconnect(organizationId, account.id, `graph 401: ${res.message}`);
      return { ok: false, reason: "reconnect" };
    }
    if (res.status === 429 && !throttled) {
      throttled = true;
      await sleep(Math.min(res.retryAfter ?? THROTTLE_WAIT_DEFAULT_S, THROTTLE_WAIT_MAX_S) * 1000);
      continue;
    }
    if (res.status === 404 || res.status === 400) return { ok: false, reason: "not_found" };
    console.error("Microsoft inbox call failed", res.status, res.code, res.message);
    return { ok: false, reason: "temporary" };
  }
}

/** The Inbox folder's id and unread count. */
function inboxFolder(token: string) {
  return graphCall<{ id?: string; unreadItemCount?: number }>(
    `${GRAPH}/me/mailFolders/inbox?$select=id,unreadItemCount`,
    { method: "GET", token, timeoutMs: 15_000 },
  );
}

/** A message's folder, to keep every call inside the Inbox (2 calls at once). */
async function ensureInInbox(token: string, messageId: string): Promise<GraphResult<{ fromEmail: string | null }>> {
  const [folder, message] = await Promise.all([
    inboxFolder(token),
    graphCall<{ parentFolderId?: string; from?: unknown }>(`${msgUrl(messageId)}?$select=parentFolderId,from`, {
      method: "GET",
      token,
      timeoutMs: 15_000,
    }),
  ]);
  if (!folder.ok) return folder;
  if (!message.ok) return message;
  if (!folder.data.id || message.data.parentFolderId !== folder.data.id) {
    return { ok: false, status: 404, code: null, message: "not in the inbox", retryAfter: null };
  }
  const summary = summaryFromGraph({ id: messageId, from: message.data.from });
  return { ok: true, status: 200, data: { fromEmail: summary?.from.email ?? null }, location: null };
}

export type InboxPage = { messages: InboxMessageSummary[]; unreadCount: number };
/** The opened e-mail, or why it can't be shown (the list loads either way). */
export type InboxDetailResult = { ok: true; data: InboxMessageDetail } | { ok: false; reason: "not_found" | "temporary" };
/** What the Inbox tab shows: the list and, when an e-mail is open, that e-mail (null otherwise). */
export type InboxView = { page: InboxPage; detail: InboxDetailResult | null };

/**
 * The Inbox tab under one token and at most 3 Graph calls at a time: the
 * Inbox folder first (id + unread count), then the newest INBOX_PAGE_SIZE
 * e-mails together with the opened e-mail and its attachment list, then that
 * e-mail's inline images one by one, then its "read" mark.
 *
 * `unreadOnly` filters at Microsoft; a search (Graph's $search, which can't be
 * combined with $filter/$orderby) comes back in Microsoft's own order.
 * Opening an unread e-mail marks it read in the mailbox, as Outlook does, and
 * the returned page already shows it read and counts one unread less. A
 * missing or moved e-mail only fails `detail`; a refused token fails the
 * whole view.
 */
export function loadInboxView(
  organizationId: string,
  opts: { search: string; unreadOnly: boolean; messageId: string | null },
): Promise<MailboxResult<InboxView>> {
  const { messageId } = opts;
  return withMailbox<InboxView>(organizationId, async ({ token, throttled }) => {
    const folder = await inboxFolder(token);
    if (!folder.ok) return folder;

    const params = new URLSearchParams({ $select: SUMMARY_SELECT, $top: String(INBOX_PAGE_SIZE) });
    const search = graphSearchValue(opts.search);
    if (search) {
      params.set("$search", search);
    } else {
      // Graph wants the $orderby property in the $filter too, in the same order.
      if (opts.unreadOnly) params.set("$filter", "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false");
      params.set("$orderby", "receivedDateTime desc");
    }
    const [list, message, attachments] = await Promise.all([
      graphCall<{ value?: unknown[] }>(`${GRAPH}/me/mailFolders/inbox/messages?${params.toString()}`, {
        method: "GET",
        token,
      }),
      messageId
        ? graphCall<Record<string, unknown>>(`${msgUrl(messageId)}?$select=${DETAIL_SELECT}`, { method: "GET", token })
        : null,
      messageId
        ? graphCall<{ value?: unknown[] }>(`${msgUrl(messageId)}/attachments?$select=id,name,contentType,size,isInline`, {
            method: "GET",
            token,
          })
        : null,
    ]);
    if (!list.ok) return list;
    // The opened e-mail's own failures stay in `detail`, except a refused token
    // (renewed for the whole view) and a first 429 (waited out with it).
    const retryWhole = (f: GraphFailure) => f.status === 401 || (f.status === 429 && !throttled);
    if (message && !message.ok && retryWhole(message)) return message;
    if (attachments && !attachments.ok && retryWhole(attachments)) return attachments;

    let messages = (list.data.value ?? []).map(summaryFromGraph).filter((m): m is InboxMessageSummary => m !== null);
    if (search && opts.unreadOnly) messages = messages.filter((m) => !m.isRead);
    let unreadCount = folder.data.unreadItemCount ?? 0;

    let detail: InboxDetailResult | null = null;
    if (messageId && message) {
      if (!message.ok) {
        const gone = message.status === 404 || message.status === 400;
        if (!gone) console.error("Microsoft inbox message failed", message.status, message.code, message.message);
        detail = { ok: false, reason: gone ? "not_found" : "temporary" };
      } else if (!folder.data.id || message.data.parentFolderId !== folder.data.id) {
        detail = { ok: false, reason: "not_found" };
      } else {
        detail = await openedMessage(token, messageId, message.data, attachments?.ok ? attachments.data.value : undefined);
      }
    }

    if (messageId && detail?.ok && !detail.data.isRead) {
      const opened = detail.data;
      const marked = await graphCall<unknown>(msgUrl(messageId), {
        method: "PATCH",
        token,
        contentType: "application/json",
        body: JSON.stringify({ isRead: true }),
        timeoutMs: 10_000,
      });
      if (marked.ok) {
        opened.isRead = true;
        messages = messages.map((m) => (m.id === opened.id ? { ...m, isRead: true } : m));
        unreadCount = Math.max(0, unreadCount - 1);
      }
    }

    return { ok: true, data: { page: { messages, unreadCount }, detail } };
  });
}

/** The opened e-mail as the reading pane shows it: body as a sandboxed document, inline images in it. */
async function openedMessage(
  token: string,
  messageId: string,
  raw: Record<string, unknown>,
  attachments: unknown,
): Promise<InboxDetailResult> {
  const summary = summaryFromGraph(raw);
  if (!summary) return { ok: false, reason: "not_found" };

  const body = (raw.body ?? {}) as { contentType?: unknown; content?: unknown };
  let content = typeof body.content === "string" ? body.content : "";
  const contentType = typeof body.contentType === "string" ? body.contentType : "text";
  let embedded: ReadonlySet<string> = new Set<string>();
  if (contentType.toLowerCase() === "html") {
    const inline = await inlineImages(token, messageId, content, attachments);
    content = replaceCidImages(content, inline.images);
    embedded = inline.embedded;
  }

  return {
    ok: true,
    data: {
      ...summary,
      to: addressesFromGraph(raw.toRecipients),
      cc: addressesFromGraph(raw.ccRecipients),
      bodyDocument: inboxBodyDocument({ contentType, content }),
      webLink: typeof raw.webLink === "string" && raw.webLink.startsWith("https://") ? raw.webLink : null,
      attachments: attachmentsFromGraph(attachments, embedded),
    },
  };
}

type GraphFileAttachment = { contentId?: string | null; contentType?: string | null; contentBytes?: string | null };

/**
 * The inline images an HTML body points at (`cid:`), as data URIs by content
 * id, plus the ids of the attachments that made it into the body: only those
 * leave the attachment list. Fetched one at a time (the mailbox takes few
 * concurrent calls), within INLINE_IMAGES_BUDGET_MS.
 */
async function inlineImages(
  token: string,
  messageId: string,
  html: string,
  attachments: unknown,
): Promise<{ images: Record<string, string>; embedded: Set<string> }> {
  const images: Record<string, string> = {};
  const embedded = new Set<string>();
  const wanted = new Set(Array.from(html.matchAll(CID_RE), (m) => m[1].toLowerCase()));
  if (wanted.size === 0 || !Array.isArray(attachments)) return { images, embedded };

  const candidates = attachments
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .filter(
      (a) =>
        a.isInline === true &&
        isGraphId(a.id) &&
        String(a.contentType ?? "").toLowerCase().startsWith("image/") &&
        typeof a.size === "number" &&
        a.size <= INLINE_IMAGE_MAX_BYTES,
    )
    .slice(0, INLINE_IMAGES_MAX);

  const deadline = Date.now() + INLINE_IMAGES_BUDGET_MS;
  let spent = 0;
  for (const a of candidates) {
    if (wanted.size === 0 || Date.now() >= deadline) break;
    // Over the page budget: this one stays in the attachment list.
    if (spent + Number(a.size) > INLINE_IMAGES_TOTAL_BYTES) continue;
    const id = String(a.id);
    const file = await graphCall<GraphFileAttachment>(`${msgUrl(messageId)}/attachments/${encodeURIComponent(id)}`, {
      method: "GET",
      token,
      timeoutMs: Math.max(1_000, deadline - Date.now()),
    });
    if (!file.ok) {
      // Throttled: stop asking; the remaining images stay in the attachment list.
      if (file.status === 429) break;
      continue;
    }
    const cid = (file.data.contentId ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
    const type = /^\s*(image\/[a-z0-9.+-]+)/i.exec(file.data.contentType ?? "")?.[1];
    if (!cid || !wanted.has(cid) || !type || !file.data.contentBytes) continue;
    images[cid] = `data:${type};base64,${file.data.contentBytes}`;
    spent += Number(a.size);
    embedded.add(id);
    wanted.delete(cid);
  }
  return { images, embedded };
}

/** Unread e-mails in the Inbox, for the "Envios" tab and channel card badges. Null when it can't be read now. */
export async function inboxUnreadCount(organizationId: string): Promise<number | null> {
  const res = await withMailbox<{ id?: string; unreadItemCount?: number }>(organizationId, ({ token }) => inboxFolder(token));
  return res.ok ? (res.data.unreadItemCount ?? 0) : null;
}

/**
 * Reply to an Inbox e-mail from the connected mailbox (Graph `reply`): same
 * conversation, quoted original, saved in Sent Items. Returns who it went to.
 * `uncertain`: Microsoft didn't answer (timeout) or failed after taking the
 * request, so the reply may have gone out; it must not be offered as a plain retry.
 */
export function replyToInbox(
  organizationId: string,
  messageId: string,
  commentHtml: string,
): Promise<MailboxResult<{ accountId: string; to: string | null; uncertain: boolean }>> {
  return withMailbox<{ accountId: string; to: string | null; uncertain: boolean }>(organizationId, async ({ token, accountId }) => {
    const where = await ensureInInbox(token, messageId);
    if (!where.ok) return where;
    const sent = await graphCall<unknown>(`${msgUrl(messageId)}/reply`, {
      method: "POST",
      token,
      contentType: "application/json",
      body: JSON.stringify({ comment: commentHtml }),
      timeoutMs: 60_000,
    });
    if (!sent.ok) {
      if (sent.status === 0 || sent.status >= 500) {
        return { ok: true, data: { accountId, to: where.data.fromEmail, uncertain: true } };
      }
      return sent;
    }
    return { ok: true, data: { accountId, to: where.data.fromEmail, uncertain: false } };
  });
}

/** A file attachment's bytes as they arrive from Microsoft; `size` is null when Microsoft doesn't say. */
export type InboxAttachmentDownload = { name: string; body: ReadableStream<Uint8Array>; size: number | null };

/**
 * One file attachment of an Inbox e-mail, streamed from Graph's `/$value`
 * (never buffered: attachments may be 150 MB). Only the response headers are
 * awaited here, so a 401/429 is still retried by withMailbox; the caller
 * pipes `body` on.
 */
export function downloadInboxAttachment(
  organizationId: string,
  messageId: string,
  attachmentId: string,
): Promise<MailboxResult<InboxAttachmentDownload>> {
  return withMailbox<InboxAttachmentDownload>(organizationId, async ({ token }) => {
    const where = await ensureInInbox(token, messageId);
    if (!where.ok) return where;
    const url = `${msgUrl(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
    // Graph always sends @odata.type: only file attachments have bytes (not Outlook items or cloud links).
    const meta = await graphCall<{ name?: string | null; "@odata.type"?: string }>(`${url}?$select=name`, {
      method: "GET",
      token,
      timeoutMs: 15_000,
    });
    if (!meta.ok) return meta;
    if (meta.data["@odata.type"] !== "#microsoft.graph.fileAttachment") return { ok: false, reason: "not_found" };
    const file = await graphGetStream(`${url}/$value`, token);
    if (!file.ok) return file;
    return { ok: true, data: { name: meta.data.name?.trim() || "anexo", body: file.body, size: file.contentLength } };
  });
}
