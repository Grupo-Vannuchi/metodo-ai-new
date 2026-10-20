/**
 * Pure rules of the Microsoft mailbox's inbox (E-mail › Pela conta Microsoft ›
 * Caixa de entrada). No server imports, so check:email and the client
 * components can import it.
 */
import { escapeHtml } from "../render";

/** E-mails one inbox page shows (newest first). Older ones are reached by search. */
export const INBOX_PAGE_SIZE = 50;
/** Longest reply typed in the inbox. */
export const REPLY_MAX_CHARS = 10_000;
/** Longest search text sent to Microsoft. */
export const SEARCH_MAX_CHARS = 100;

/** Which tab of the Microsoft channel page is open (`?aba=`). */
export type MicrosoftTab = "envios" | "caixa";

export function microsoftTabFromParam(param: string | string[] | undefined): MicrosoftTab {
  const value = Array.isArray(param) ? param[0] : param;
  return value === "caixa" ? "caixa" : "envios";
}

/** The inbox list's filter (`?filtro=`). */
export type InboxFilter = "todas" | "nao-lidas" | "respostas";

const INBOX_FILTERS: readonly InboxFilter[] = ["todas", "nao-lidas", "respostas"];

export function inboxFilterFromParam(param: string | string[] | undefined): InboxFilter {
  const value = Array.isArray(param) ? param[0] : param;
  return (INBOX_FILTERS as readonly string[]).includes(value ?? "") ? (value as InboxFilter) : "todas";
}

/** Search text from `?q=`: trimmed, capped, empty → "". */
export function inboxSearchFromParam(param: string | string[] | undefined): string {
  const value = Array.isArray(param) ? param[0] : param;
  return (value ?? "").trim().slice(0, SEARCH_MAX_CHARS);
}

/**
 * Microsoft Graph ids (messages, attachments) are base64-like. Anything else is
 * refused before it reaches a Graph URL.
 */
export function isGraphId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9+/=_-]{1,512}$/.test(value);
}

/** The inbox tab's URL with its state; defaults are left out so links stay short. */
export function inboxHref(state: { filtro?: InboxFilter; q?: string; msg?: string } = {}): string {
  const params = new URLSearchParams({ canal: "microsoft", aba: "caixa" });
  if (state.filtro && state.filtro !== "todas") params.set("filtro", state.filtro);
  if (state.q) params.set("q", state.q);
  if (state.msg) params.set("msg", state.msg);
  return `/app/email?${params.toString()}`;
}

/** The `$search` value for Graph: quotes and backslashes dropped, wrapped in quotes. Null when empty. */
export function graphSearchValue(text: string): string | null {
  const clean = text.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_CHARS);
  return clean ? `"${clean}"` : null;
}

export type InboxAddress = { name: string | null; email: string | null };

export type InboxMessageSummary = {
  id: string;
  subject: string;
  from: InboxAddress;
  /** ISO date. */
  receivedAt: string;
  isRead: boolean;
  hasAttachments: boolean;
  preview: string;
};

export type InboxAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** Only file attachments can be downloaded (not Outlook items or cloud links). */
  downloadable: boolean;
};

export type InboxMessageDetail = InboxMessageSummary & {
  to: InboxAddress[];
  cc: InboxAddress[];
  /** The body as a whole HTML document for a sandboxed iframe. */
  bodyDocument: string;
  webLink: string | null;
  attachments: InboxAttachment[];
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function addressFromGraph(value: unknown): InboxAddress {
  const ea = (value && typeof value === "object" ? (value as { emailAddress?: unknown }).emailAddress : null) as {
    name?: unknown;
    address?: unknown;
  } | null;
  const email = str(ea?.address).trim().toLowerCase();
  const name = str(ea?.name).trim();
  return { name: name || null, email: email || null };
}

export function addressesFromGraph(value: unknown): InboxAddress[] {
  return Array.isArray(value) ? value.map(addressFromGraph).filter((a) => a.email || a.name) : [];
}

/** A Graph message (any subset of its fields) as a list row. Null without an id. */
export function summaryFromGraph(raw: unknown): InboxMessageSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (!isGraphId(m.id)) return null;
  return {
    id: m.id,
    subject: str(m.subject).trim(),
    from: addressFromGraph(m.from),
    receivedAt: str(m.receivedDateTime) || new Date(0).toISOString(),
    isRead: m.isRead === true,
    hasAttachments: m.hasAttachments === true,
    preview: str(m.bodyPreview).replace(/\s+/g, " ").trim(),
  };
}

/**
 * Graph's attachment list as rows. Inline attachments whose id is in
 * `embedded` (images already shown in the body as data URIs) are left out;
 * any other inline part and every regular attachment stays listed.
 */
export function attachmentsFromGraph(value: unknown, embedded: ReadonlySet<string> = new Set()): InboxAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: InboxAttachment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    if (!isGraphId(a.id)) continue;
    if (a.isInline === true && embedded.has(a.id)) continue;
    out.push({
      id: a.id,
      name: str(a.name).trim() || "anexo",
      contentType: str(a.contentType),
      size: typeof a.size === "number" ? a.size : 0,
      downloadable: a["@odata.type"] === "#microsoft.graph.fileAttachment",
    });
  }
  return out;
}

/**
 * Leading reply/forward/auto-reply markers ("Re:", "RES:", "Fwd:", "Resposta
 * automática:", "Automatic reply:"…), repeated or with a counter ("RE[2]:").
 */
const SUBJECT_PREFIX_RE =
  /^(\s*((re|res|enc|fw|fwd|tr|aw|wg|sv|antw|resposta autom[aá]tica|automatic reply|auto[- ]?reply|out of office|ausente)\s*(\[\d+\])?\s*:|\[[^\]]{1,40}\]|\*[^*]{1,40}\*)\s*)+/i;

/** A subject for comparison: markers removed, spaces collapsed, lower case. */
export function normalizeSubject(subject: string): string {
  return subject.replace(SUBJECT_PREFIX_RE, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const TEMPLATE_VAR_RE = /\{\{\s*(nome|empresa)\s*\}\}/gi;

/**
 * Does a received subject answer this send's subject? Both are compared
 * normalized (see normalizeSubject). The send's subject may carry
 * {{nome}}/{{empresa}}, filled per recipient: its literal pieces must appear
 * in order, the first one at the start and the last one at the end unless a
 * variable sits there. Without variables, that means equal subjects.
 */
export function subjectAnswers(receivedSubject: string, sendSubject: string): boolean {
  const received = normalizeSubject(receivedSubject);
  const parts = normalizeSubject(sendSubject)
    .split(TEMPLATE_VAR_RE)
    .filter((_, i) => i % 2 === 0)
    .map((p) => p.trim());
  const pieces = parts.filter(Boolean);
  if (!received || pieces.length === 0) return false;
  const startsWithVar = parts[0] === "";
  const endsWithVar = parts[parts.length - 1] === "";
  let from = 0;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    let at = received.indexOf(piece, from);
    if (i === pieces.length - 1 && !endsWithVar) {
      at = received.endsWith(piece) ? received.length - piece.length : -1;
    }
    if (i === 0 && !startsWithVar && at !== 0) return false;
    if (at < from) return false;
    from = at + piece.length;
  }
  return true;
}

/** One e-mail of a Microsoft send that went to someone. */
export type SentToAddress = { email: string; broadcastId: string; subject: string; sentAt: Date };
export type ReplyMatch = { broadcastId: string; subject: string; sentAt: Date };

/**
 * The mass e-mail a received message answers: its sender got that send from
 * the Microsoft channel before the message arrived, and the subjects match
 * (see subjectAnswers). The most recent such send wins. Graph keeps no link
 * back to our sends (sendMail returns no id), so this is a best guess.
 */
export function matchReplyToSend(
  message: { fromEmail: string | null; subject: string; receivedAt: Date },
  sends: readonly SentToAddress[],
): ReplyMatch | null {
  if (!message.fromEmail) return null;
  const from = message.fromEmail.toLowerCase();
  let best: SentToAddress | null = null;
  for (const s of sends) {
    if (s.email.toLowerCase() !== from) continue;
    if (s.sentAt.getTime() > message.receivedAt.getTime()) continue;
    if (!subjectAnswers(message.subject, s.subject)) continue;
    if (!best || s.sentAt.getTime() > best.sentAt.getTime()) best = s;
  }
  return best ? { broadcastId: best.broadcastId, subject: best.subject, sentAt: best.sentAt } : null;
}

/** The typed reply as the HTML `comment` Graph puts above the quoted e-mail. */
export function replyHtmlFromText(text: string): string {
  const lines = text.trim().split(/\r?\n/).map((line) => escapeHtml(line));
  return `<div>${lines.join("<br>")}</div>`;
}

/**
 * Point `cid:` references (inline images) at data URIs. Keys are content ids,
 * with or without angle brackets; unknown ids are left alone.
 */
export function replaceCidImages(html: string, images: Record<string, string>): string {
  const byId = new Map<string, string>();
  for (const [id, uri] of Object.entries(images)) byId.set(id.replace(/^<|>$/g, "").toLowerCase(), uri);
  if (byId.size === 0) return html;
  return html.replace(/cid:([^"'\s)>]+)/gi, (match, id: string) => byId.get(id.toLowerCase()) ?? match);
}

/**
 * Content-Security-Policy of the body document: no scripts, frames, forms or
 * connections; images, styles and fonts may load (as in any mail client).
 */
const BODY_CSP =
  "default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; form-action 'none'";

/**
 * Puts rel="noopener noreferrer" first on every `<a>` and `<area>` tag. HTML
 * keeps the first copy of a repeated attribute, so a sender's rel="opener" is
 * ignored and the tab a link opens can't reach back to the app's tab
 * (reverse tabnabbing). `<abbr>`, `<address>`… are left alone.
 */
export function neutralizeOpeners(html: string): string {
  return html.replace(/<(a|area)(?=[\t\n\f\r />])/gi, "<$1 rel=noopener ");
}

/**
 * A received body as a whole document for `<iframe sandbox srcdoc>`. The
 * sender's HTML is never placed in the app's own DOM: the sandbox (no
 * scripts, no same origin) and this CSP keep it inert, and links open in a
 * new tab without a handle on the app (see neutralizeOpeners).
 */
export function inboxBodyDocument(body: { contentType: string; content: string }): string {
  const head =
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${BODY_CSP}">` +
    `<meta name="referrer" content="no-referrer"><base target="_blank">` +
    "<style>html{background:#ffffff}body{margin:0;padding:8px;color:#0a0a0a;" +
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.55;' +
    "overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style>";
  const inner =
    body.contentType.toLowerCase() === "html"
      ? neutralizeOpeners(body.content)
      : `<div style="white-space:pre-wrap">${escapeHtml(body.content)}</div>`;
  return `<!doctype html><html><head>${head}</head><body>${inner}</body></html>`;
}

/**
 * Content-Disposition that always downloads, with an ASCII fallback and the
 * UTF-8 name (RFC 5987). A lone surrogate becomes U+FFFD, since
 * encodeURIComponent throws on it; ' ( ) * are escaped too, as the RFC asks.
 */
export function attachmentDisposition(name: string): string {
  const clean =
    name
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) => (m.length === 2 ? m : "\uFFFD"))
      .replace(/[\r\n]/g, " ")
      .trim() || "anexo";
  const fallback = clean.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
