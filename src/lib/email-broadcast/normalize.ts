/**
 * E-mail helpers shared by the composer (to paint invalid chips red) and the
 * server (to resolve the audience), so both sides agree on what "the same
 * address" and "invalid" mean. Client-safe and free of `server-only` on
 * purpose: scripts/check-email-broadcast.ts imports it directly.
 */

const EMAIL_RE =
  /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** Dedupe key for an address: trimmed and lowercased. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Pragmatic validity check on an already-normalized address. */
export function isValidEmail(normalized: string): boolean {
  return normalized.length > 0 && normalized.length <= 254 && EMAIL_RE.test(normalized);
}

/**
 * Split a typed or pasted list into normalized addresses. Separators: comma,
 * semicolon, whitespace and newlines. "Name <addr>" keeps only `addr`. Tokens
 * without "@" are dropped (they're names or search terms, not addresses), so
 * only things that look like an address — valid or not — come back.
 */
export function parseEmailList(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/[,;\r\n]+/)) {
    const angle = chunk.match(/<([^>]*)>/);
    const candidate = angle ? angle[1] : chunk;
    for (const token of candidate.split(/\s+/)) {
      const email = normalizeEmail(token);
      if (email.includes("@")) out.push(email);
    }
  }
  return out;
}
