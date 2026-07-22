/**
 * Client-safe OAuth provider identifiers and display labels.
 *
 * Kept apart from `providers.ts` — which is server-only, since it holds the
 * client secrets and the arctic clients — so Client Components (buttons, the
 * profile's linked-accounts card) can name providers without dragging server
 * code into the browser bundle.
 */

export const OAUTH_PROVIDERS = ["google", "microsoft", "linkedin"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Brand names, as shown in buttons and error copy. */
export const OAUTH_LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
};

/** Narrow an arbitrary route segment to a known provider. */
export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Turn the OAuth callback's `?error=<provider>[_unverified]` into the i18n key
 * plus the brand name to interpolate. Anything unrecognized falls back to the
 * generic message, so a stray query string can't blow up the page.
 */
export function parseOAuthError(raw: string | undefined): { key: string; provider: string } | null {
  if (!raw) return null;
  const m = /^([a-z]+)(_unverified)?$/.exec(raw);
  if (m && isOAuthProvider(m[1])) {
    return { key: m[2] ? "oauth_unverified" : "oauth", provider: OAUTH_LABELS[m[1]] };
  }
  return { key: "generic", provider: "" };
}
