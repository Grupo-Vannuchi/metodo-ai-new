/**
 * Reading what an IMAP server hands over (spec 2026-10-23): whether the list's
 * message has attachments (from its body structure, which costs no download) and
 * the opened e-mail as the reading pane shows it (from postal-mime's parse of
 * the whole message). No `server-only`, so check:email can import it, but it uses
 * Buffer: server side only, never from a client component.
 */
import type { Attachment, Email, Mailbox } from "postal-mime";
import {
  inboxBodyDocument,
  replaceCidImages,
  type InboxAddress,
  type InboxAttachment,
  type InboxMessageDetail,
  type InboxMessageSummary,
} from "../microsoft/inbox-core";
import { addressFromImap } from "./core";

/** A message larger than this isn't downloaded or parsed: its headers and an "open it in the webmail" notice are shown. */
export const IMAP_MAX_MESSAGE_BYTES = 15 * 1024 * 1024;

/** imapflow's body structure, as far as attachments are concerned (its MessageStructureObject fits). */
export type ImapBodyNode = {
  type?: string;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  parameters?: Record<string, string>;
  childNodes?: ImapBodyNode[];
};

/** The part's file name: Content-Disposition's `filename`, else Content-Type's `name`. */
function nodeFileName(node: ImapBodyNode): string {
  return (node.dispositionParameters?.filename || node.parameters?.name || "").trim();
}

function structureHasFile(node: ImapBodyNode, insideRelated: boolean): boolean {
  if ((node.disposition ?? "").toLowerCase() === "attachment") return true;
  const type = (node.type ?? "").toLowerCase();
  if (node.childNodes?.length) {
    // A forwarded message (message/rfc822) is walked like a multipart: what it carries counts.
    const related = insideRelated || type === "multipart/related";
    return node.childNodes.some((child) => structureHasFile(child, related));
  }
  // A leaf that isn't marked as an attachment is a file only if it is named; the body's text and the
  // resources its HTML points at (multipart/related, such as inline images) are not.
  if (insideRelated || type === "text/plain" || type === "text/html") return false;
  return nodeFileName(node) !== "";
}

/**
 * Does a message have attachments? Read from the body structure, so the list
 * never downloads a body for it. Like Graph's `hasAttachments`, it leaves out
 * the images inside the body: a part marked as an attachment counts anywhere, a
 * named one counts when it is not inside a multipart/related, and an unnamed
 * inline part does not count.
 */
export function hasAttachmentsInStructure(node: ImapBodyNode | undefined): boolean {
  return node ? structureHasFile(node, false) : false;
}

/** Inline images shown in the body as data URIs: at most this many, each up to this size, all within this total (as the Microsoft inbox). */
const INLINE_IMAGES_MAX = 10;
const INLINE_IMAGE_MAX_BYTES = 1_500_000;
/** All inline images of one e-mail together (the page carries them twice: HTML and RSC payload). */
const INLINE_IMAGES_TOTAL_BYTES = 4_000_000;
/** `cid:` references of an HTML body, read as replaceCidImages reads them. */
const CID_RE = /cid:([^"'\s)>]+)/gi;
/** What may become a data URI's type: nothing that could close the attribute it is written in. */
const IMAGE_TYPE_RE = /^image\/[a-z0-9.+-]+$/i;
/** The most attachments listed: the highest index isAttachmentIndex accepts is 999. */
const MAX_LISTED_ATTACHMENTS = 1_000;

/** The attachment's size in bytes, without copying it. */
function sizeOf(a: Attachment): number {
  const c = a.content;
  if (typeof c === "string") return Buffer.byteLength(c, a.encoding === "base64" ? "base64" : "utf8");
  return c.byteLength;
}

/** The attachment's bytes, whichever form postal-mime handed them over in (it depends on `attachmentEncoding`). */
function bytesOf(a: Attachment): Buffer {
  const c = a.content;
  if (typeof c === "string") return Buffer.from(c, a.encoding === "base64" ? "base64" : "utf8");
  return c instanceof Uint8Array ? Buffer.from(c.buffer, c.byteOffset, c.byteLength) : Buffer.from(c);
}

/** How many times the body points at each content id (lower case, no angle brackets). */
function cidReferences(html: string): Map<string, number> {
  const refs = new Map<string, number>();
  for (const match of html.matchAll(CID_RE)) {
    const cid = match[1].toLowerCase();
    refs.set(cid, (refs.get(cid) ?? 0) + 1);
  }
  return refs;
}

/**
 * The attachments the body shows itself, by index in `parsed.attachments`, each
 * with its content id: images the HTML points at with `cid:`, within the limits
 * above. One function decides this for the body (which embeds them) and for the
 * list (which hides them), so the two can never disagree: an image that didn't
 * fit stays in the list and the file stays reachable. As with Graph's `isInline`,
 * a part the sender marked as an attachment is never turned into part of the body.
 * Every `cid:` in the HTML counts against the total, since each one is replaced
 * by the whole image: a body that repeats one reference can't multiply it.
 */
function embeddedImages(parsed: Pick<Email, "attachments" | "html">): Map<number, string> {
  const embedded = new Map<number, string>();
  const refs = parsed.html ? cidReferences(parsed.html) : new Map<string, number>();
  if (refs.size === 0) return embedded;
  const taken = new Set<string>();
  let spent = 0;
  for (let index = 0; index < parsed.attachments.length && embedded.size < INLINE_IMAGES_MAX; index++) {
    const a = parsed.attachments[index];
    const cid = (a.contentId ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
    if (!cid || taken.has(cid) || !refs.has(cid)) continue;
    if (!IMAGE_TYPE_RE.test(a.mimeType.trim()) || (a.disposition ?? "").toLowerCase() === "attachment") continue;
    const size = sizeOf(a);
    if (size === 0 || size > INLINE_IMAGE_MAX_BYTES) continue;
    // Over the budget: this one stays in the list, a smaller one after it may still fit.
    const cost = size * (refs.get(cid) ?? 1);
    if (spent + cost > INLINE_IMAGES_TOTAL_BYTES) continue;
    spent += cost;
    taken.add(cid);
    embedded.set(index, cid);
  }
  return embedded;
}

type ListedAttachment = { index: number; attachment: Attachment };

/** Every attachment but the ones the body shows itself, each with its index in the parsed list. */
function listExcept(attachments: Attachment[], embedded: ReadonlyMap<number, string>): ListedAttachment[] {
  const listed: ListedAttachment[] = [];
  const last = Math.min(attachments.length, MAX_LISTED_ATTACHMENTS);
  for (let index = 0; index < last; index++) {
    if (!embedded.has(index)) listed.push({ index, attachment: attachments[index] });
  }
  return listed;
}

/**
 * The attachments to list for an e-mail, each with its index in
 * `parsed.attachments`: that index is its id in the URL, and what the download
 * route checks an id against. The images the body shows itself are left out.
 */
export function listedAttachments(
  parsed: Pick<Email, "attachments" | "html">,
): { index: number; attachment: Attachment }[] {
  return listExcept(parsed.attachments, embeddedImages(parsed));
}

/** Recipients as the pane shows them: address groups opened, a blank entry dropped. */
function inboxAddresses(list: Email["to"]): InboxAddress[] {
  const out: InboxAddress[] = [];
  for (const entry of list ?? []) {
    const mailboxes: Mailbox[] = entry.group ? entry.group : [entry];
    for (const m of mailboxes) {
      const address = addressFromImap(m.name, m.address);
      if (address.email || address.name) out.push(address);
    }
  }
  return out;
}

/**
 * The opened e-mail as the reading pane shows it, from the list row and
 * postal-mime's parse of the whole message. An HTML body has its `cid:` images
 * turned into data URIs (embeddedImages); a message with no HTML (or only
 * blanks) shows its text. Either way the body is a whole document for a
 * sandboxed iframe (inboxBodyDocument), never the sender's HTML in the app's DOM.
 * What the body shows is decided once, and the list leaves out exactly that. An
 * attachment's id is its index in `parsed.attachments`, as listedAttachments has
 * it. There is no webmail link to offer.
 */
export function detailFromParsed(summary: InboxMessageSummary, parsed: Email): InboxMessageDetail {
  const embedded = embeddedImages(parsed);
  const html = parsed.html?.trim() ? parsed.html : null;
  let bodyDocument: string;
  if (html !== null) {
    const images = Object.fromEntries(
      Array.from(embedded, ([index, cid]) => {
        const image = parsed.attachments[index];
        return [cid, `data:${image.mimeType.trim().toLowerCase()};base64,${bytesOf(image).toString("base64")}`];
      }),
    );
    bodyDocument = inboxBodyDocument({ contentType: "html", content: replaceCidImages(html, images) });
  } else {
    bodyDocument = inboxBodyDocument({ contentType: "text", content: parsed.text ?? "" });
  }
  const attachments: InboxAttachment[] = listExcept(parsed.attachments, embedded).map(({ index, attachment }) => ({
    id: String(index),
    name: (attachment.filename ?? "").trim() || "anexo",
    contentType: attachment.mimeType,
    size: sizeOf(attachment),
    downloadable: true,
  }));
  return {
    ...summary,
    to: inboxAddresses(parsed.to),
    cc: inboxAddresses(parsed.cc),
    bodyDocument,
    webLink: null,
    attachments,
  };
}
