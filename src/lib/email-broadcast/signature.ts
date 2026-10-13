/**
 * E-mail signature rules (spec 2026-10-13). Pure and free of `server-only`:
 * the signature form, the actions, the composer pages, the start of a send and
 * scripts/check-email-broadcast.ts all use it. The HTML built here is
 * sanitized on the server (compose.ts) before it is shown or sent.
 */
import { escapeHtml, hasEmailContent, htmlToText } from "./render";
import { safeClickHref, safeImageSrc } from "./image-links";

export const MAX_SIGNATURES = 20;
export const MAX_SIGNATURE_NAME = 60;
export const MAX_SIGNATURE_HTML = 50_000;
/** Intro text and alt text of an image signature. */
export const MAX_SIGNATURE_LINE = 200;

export type SignatureKind = "TEXT" | "IMAGE";

export type SignatureContent =
  | { kind: "TEXT"; html: string }
  | { kind: "IMAGE"; imageUrl: string; imageAlt: string; imageHref: string | null; introText: string | null };

export type SignatureProblem =
  | "html_empty"
  | "html_too_long"
  | "image_required"
  | "image_url"
  | "alt_required"
  | "line_too_long"
  | "href";

/** What the form edits (every field a string; the unused kind's are ignored). */
export type SignatureFormFields = {
  kind: SignatureKind;
  html: string;
  imageUrl: string;
  imageAlt: string;
  imageHref: string;
  introText: string;
};

/** The columns of an email_signatures row this module reads. */
export type SignatureRow = {
  kind: SignatureKind;
  html: string;
  imageUrl: string | null;
  imageAlt: string | null;
  imageHref: string | null;
  introText: string | null;
};

/** Apply `fn` until the output stops changing (max `maxPasses`); "" if it never
 * settles. Used with the single-pass HTML sanitizer so a removed tag can't
 * splice a new one together (`<<x>img ...>`). */
export function untilStable(fn: (s: string) => string, input: string, maxPasses = 10): string {
  let current = input;
  for (let i = 0; i < maxPasses; i++) {
    const next = fn(current);
    if (next === current) return current;
    current = next;
  }
  return "";
}

/** Image source of a signature: https, or this app's own local-disk media
 * route on localhost (dev storage serves /api/media/ over plain http). */
export function signatureImageSrc(raw: string): string | null {
  const https = safeImageSrc(raw);
  if (https) return https;
  try {
    const url = new URL(raw.trim());
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "http:" && local && url.pathname.startsWith("/api/media/") ? url.href : null;
  } catch {
    return null;
  }
}

/** First reason the content can't be saved, or null. */
export function signatureProblem(content: SignatureContent): SignatureProblem | null {
  if (content.kind === "TEXT") {
    if (!hasEmailContent(content.html)) return "html_empty";
    return content.html.length > MAX_SIGNATURE_HTML ? "html_too_long" : null;
  }
  if (!content.imageUrl.trim()) return "image_required";
  if (!signatureImageSrc(content.imageUrl)) return "image_url";
  if (!content.imageAlt.trim()) return "alt_required";
  if (
    content.imageAlt.trim().length > MAX_SIGNATURE_LINE ||
    (content.introText ?? "").trim().length > MAX_SIGNATURE_LINE
  ) {
    return "line_too_long";
  }
  if (content.imageHref && !safeClickHref(content.imageHref)) return "href";
  return null;
}

/** HTML (to be sanitized by the caller) and plain-text part of a signature. */
export function renderSignature(content: SignatureContent): { html: string; text: string } {
  if (content.kind === "TEXT") {
    return { html: content.html, text: htmlToText(content.html).trim() };
  }
  const src = signatureImageSrc(content.imageUrl) ?? "";
  const href = content.imageHref ? safeClickHref(content.imageHref) : null;
  const intro = content.introText?.trim() || null;
  const alt = content.imageAlt.trim();
  const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  const html = `${intro ? `<p>${escapeHtml(intro)}</p>` : ""}${href ? `<a href="${escapeHtml(href)}">${img}</a>` : img}`;
  const text = [intro, alt, href].filter((line): line is string => Boolean(line)).join("\n");
  return { html, text };
}

/** Form fields -> content: trimmed, empty optionals become null. */
export function signatureContentFromForm(fields: SignatureFormFields): SignatureContent {
  if (fields.kind === "TEXT") return { kind: "TEXT", html: fields.html };
  return {
    kind: "IMAGE",
    imageUrl: fields.imageUrl.trim(),
    imageAlt: fields.imageAlt.trim(),
    imageHref: fields.imageHref.trim() || null,
    introText: fields.introText.trim() || null,
  };
}

/** A stored row -> content. */
export function signatureContentOf(row: SignatureRow): SignatureContent {
  if (row.kind === "IMAGE") {
    return {
      kind: "IMAGE",
      imageUrl: row.imageUrl ?? "",
      imageAlt: row.imageAlt ?? "",
      imageHref: row.imageHref,
      introText: row.introText,
    };
  }
  return { kind: "TEXT", html: row.html };
}
