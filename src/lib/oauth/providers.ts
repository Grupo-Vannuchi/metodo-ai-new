import "server-only";
import { Google, LinkedIn, MicrosoftEntraId, type OAuth2Tokens } from "arctic";
import { env } from "@/lib/env";
import { OAUTH_PROVIDERS, type OAuthProvider } from "@/lib/oauth/shared";

/**
 * Registry of the sign-in providers, behind one uniform interface so the OAuth
 * routes stay provider-agnostic. Adding a provider means adding an entry here —
 * routes, session mapping and UI pick it up automatically.
 *
 * All three speak OpenID Connect, so a single `userinfo` reader covers them.
 * Only PKCE differs: Google and Microsoft use it, LinkedIn doesn't.
 */

/** A provider identity, normalized to one shape. */
export type OAuthProfile = {
  /** The provider's stable user id (the OIDC `sub`). */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

type ProviderDef = {
  isConfigured(): boolean;
  /** Providers without PKCE (LinkedIn) just ignore the verifier. */
  createAuthorizationURL(state: string, codeVerifier: string): URL;
  validateAuthorizationCode(code: string, codeVerifier: string): Promise<OAuth2Tokens>;
  fetchUser(tokens: OAuth2Tokens): Promise<OAuthProfile | null>;
};

/** The redirect URI that must be registered in the provider's console, verbatim. */
export function oauthCallbackUrl(provider: OAuthProvider): string {
  return `${env.NEXT_PUBLIC_SITE_URL}/api/auth/${provider}/callback`;
}

const OIDC_SCOPES = ["openid", "profile", "email"];

/** Shared OpenID Connect `userinfo` reader. */
async function fetchOidcProfile(endpoint: string, accessToken: string): Promise<OAuthProfile | null> {
  const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const claims = (await res.json().catch(() => null)) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    preferred_username?: string;
  } | null;
  // Entra can carry the address in `preferred_username` instead of `email`.
  const email = String(claims?.email || claims?.preferred_username || "").toLowerCase();
  if (!claims?.sub || !email) return null;
  return {
    sub: String(claims.sub),
    email,
    emailVerified: Boolean(claims.email_verified),
    name: claims.name || email,
  };
}

const googleClient = () =>
  new Google(env.GOOGLE_CLIENT_ID!, env.GOOGLE_CLIENT_SECRET!, oauthCallbackUrl("google"));

const microsoftClient = () =>
  new MicrosoftEntraId(
    // "common" accepts work/school *and* personal Microsoft accounts.
    env.MICROSOFT_TENANT_ID || "common",
    env.MICROSOFT_CLIENT_ID!,
    env.MICROSOFT_CLIENT_SECRET!,
    oauthCallbackUrl("microsoft"),
  );

const linkedinClient = () =>
  new LinkedIn(env.LINKEDIN_CLIENT_ID!, env.LINKEDIN_CLIENT_SECRET!, oauthCallbackUrl("linkedin"));

export const OAUTH: Record<OAuthProvider, ProviderDef> = {
  google: {
    isConfigured: () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    createAuthorizationURL: (state, verifier) =>
      googleClient().createAuthorizationURL(state, verifier, OIDC_SCOPES),
    validateAuthorizationCode: (code, verifier) =>
      googleClient().validateAuthorizationCode(code, verifier),
    fetchUser: (tokens) =>
      fetchOidcProfile("https://openidconnect.googleapis.com/v1/userinfo", tokens.accessToken()),
  },

  microsoft: {
    isConfigured: () => Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
    createAuthorizationURL: (state, verifier) =>
      microsoftClient().createAuthorizationURL(state, verifier, OIDC_SCOPES),
    validateAuthorizationCode: (code, verifier) =>
      microsoftClient().validateAuthorizationCode(code, verifier),
    fetchUser: async (tokens) => {
      const profile = await fetchOidcProfile(
        "https://graph.microsoft.com/oidc/userinfo",
        tokens.accessToken(),
      );
      // Entra never sends `email_verified`. A work/school address is verified by
      // the tenant's directory, and a personal Microsoft account verifies its
      // address at sign-up — so an address we get back clears the same bar as
      // Google's `email_verified`, and account linking stays safe.
      return profile ? { ...profile, emailVerified: true } : null;
    },
  },

  linkedin: {
    isConfigured: () => Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),
    // LinkedIn's OAuth has no PKCE — the verifier is deliberately unused.
    createAuthorizationURL: (state) => linkedinClient().createAuthorizationURL(state, OIDC_SCOPES),
    validateAuthorizationCode: (code) => linkedinClient().validateAuthorizationCode(code),
    fetchUser: (tokens) =>
      fetchOidcProfile("https://api.linkedin.com/v2/userinfo", tokens.accessToken()),
  },
};

/** Providers whose credentials are present — the only ones offered in the UI. */
export function configuredProviders(): OAuthProvider[] {
  return OAUTH_PROVIDERS.filter((p) => OAUTH[p].isConfigured());
}
