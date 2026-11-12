/**
 * Validation for the two links an e-mail image can carry: where the picture
 * is loaded from, and where a click on it goes. Client-safe and free of
 * `server-only` (the composer uses it, scripts/check-email-broadcast.ts runs
 * it). The sanitizer still filters the final HTML on the server.
 */

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Image source: https only — mail clients block or warn on plain http,
 * and data: URIs are dropped anyway. */
export function safeImageSrc(raw: string): string | null {
  const value = raw.trim();
  const url = value.startsWith("https://") ? parse(value) : null;
  return url && url.protocol === "https:" ? url.href : null;
}

/** Click destination: http(s); a bare domain ("loja.com/promo") gets https://. */
export function safeClickHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = value.includes(":") ? value : `https://${value}`;
  const url = parse(withScheme);
  return url && (url.protocol === "https:" || url.protocol === "http:") ? url.href : null;
}
