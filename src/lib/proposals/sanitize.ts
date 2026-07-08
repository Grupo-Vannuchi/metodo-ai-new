import "server-only";

/**
 * Lightweight allowlist sanitizer for the rich-text HTML stored in proposal
 * documents. Runs server-side at render time — we never trust the stored HTML
 * raw, even though it comes from our own constrained editor. Deliberately
 * regex-based (no jsdom) so it stays cheap on the Passenger/CloudLinux host.
 *
 * Strategy: strip dangerous elements entirely, drop every event handler and
 * unsafe URL scheme, then keep only an allowlist of formatting tags/attributes.
 */

// Tags removed together with their content (never rendered).
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|form|noscript)\b[\s\S]*?<\/\1\s*>/gi;
// Self-closing / unpaired dangerous tags.
const DROP_TAGS = /<\/?(script|style|iframe|object|embed|form|noscript|link|meta|base)\b[^>]*>/gi;

// Formatting tags we allow through (everything else is stripped, keeping text).
const ALLOWED_TAGS = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "hr",
  "span", "div", "a", "img", "table", "thead", "tbody", "tr", "th", "td",
]);
// Attributes we allow (per tag is overkill for internal content; a flat set is fine).
const ALLOWED_ATTRS = new Set(["href", "src", "alt", "title", "colspan", "rowspan", "style", "class"]);

/** Keep only safe `style` declarations (colors, alignment, weight, size…). */
function safeStyle(value: string): string {
  return value
    .split(";")
    .map((d) => d.trim())
    .filter((d) => /^[a-z-]+\s*:\s*[^;{}()]+$/i.test(d) && !/url\s*\(|expression|javascript:/i.test(d))
    .join("; ");
}

/** True for a URL scheme we permit in href/src. */
function safeUrl(value: string): boolean {
  const v = value.trim();
  if (/^(https?:|mailto:|tel:|\/|#|\.)/i.test(v)) return true;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(v)) return true;
  return false;
}

function cleanAttributes(tag: string, attrs: string): string {
  const kept: string[] = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    const name = m[1].toLowerCase();
    const raw = m[3] ?? m[4] ?? m[5] ?? "";
    if (name.startsWith("on")) continue; // event handlers
    if (!ALLOWED_ATTRS.has(name)) continue;
    if ((name === "href" || name === "src") && !safeUrl(raw)) continue;
    const value = name === "style" ? safeStyle(raw) : raw;
    if (!value && name === "style") continue;
    kept.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
  }
  return kept.length ? " " + kept.join(" ") : "";
}

export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return "";
  let out = String(input).replace(DROP_WITH_CONTENT, "").replace(DROP_TAGS, "");

  // Walk every remaining tag; keep allowed ones (with cleaned attrs), drop the
  // rest (keeping their inner text).
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_full, slash: string, name: string, attrs: string) => {
    const tag = name.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (slash) return `</${tag}>`;
    const selfClose = tag === "br" || tag === "hr" || tag === "img";
    return `<${tag}${cleanAttributes(tag, attrs)}${selfClose ? " /" : ""}>`;
  });

  return out;
}

/** Escape plain text and turn newlines into <br> (for non-HTML fields). */
export function escToHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, "<br>");
}
