import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sealSession, getSession } from "@/lib/session";
import { OAUTH } from "@/lib/oauth/providers";
import { isOAuthProvider } from "@/lib/oauth/shared";
import { resolveOAuthSession, linkOAuthAccount } from "@/lib/oauth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Build a redirect to the PUBLIC site URL. `req.url` can't be trusted here:
 * behind the Hostinger/Passenger proxy it resolves to the internal bind address
 * (0.0.0.0:3000), producing broken redirects. */
const redirectTo = (path: string) => NextResponse.redirect(new URL(path, env.NEXT_PUBLIC_SITE_URL));

/**
 * OAuth callback for `[provider]`: validate the state, exchange the code (with
 * the PKCE verifier where the provider uses one), resolve the identity to a
 * session and sign the user in — setting cookies directly on the NextResponse.
 * Any failure bounces back to /login with an error (and logs why).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  // Linking flow ("Conectar" on the profile) vs. sign-in flow.
  const isLink = req.cookies.get(`${provider}_link_intent`)?.value === "1";
  const backOnCancel = isLink ? "/app/settings/profile" : "/login";

  /** Wipe this provider's round-trip cookies (state, PKCE, link intent). */
  const clearCookies = (res: NextResponse): NextResponse => {
    res.cookies.delete(`${provider}_oauth_state`);
    res.cookies.delete(`${provider}_code_verifier`);
    res.cookies.delete(`${provider}_link_intent`);
    return res;
  };

  const fail = (code: string) => {
    const dest = isLink ? `/app/settings/profile?error=${code}` : `/login?error=${code}`;
    return clearCookies(redirectTo(dest));
  };

  if (!isOAuthProvider(provider)) return fail("oauth");

  const params_ = req.nextUrl.searchParams;

  // The user dismissed the provider's consent screen — not an error, just go back.
  if (params_.get("error")) {
    return clearCookies(redirectTo(backOnCancel));
  }

  const def = OAUTH[provider];
  if (!def.isConfigured()) {
    console.error(`[oauth:${provider}] callback: not configured`);
    return fail(provider);
  }

  const code = params_.get("code");
  const state = params_.get("state");
  const storedState = req.cookies.get(`${provider}_oauth_state`)?.value;
  const codeVerifier = req.cookies.get(`${provider}_code_verifier`)?.value;

  if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
    console.error(`[oauth:${provider}] state/cookie mismatch`, {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasStoredState: Boolean(storedState),
      stateMatches: state === storedState,
      hasVerifier: Boolean(codeVerifier),
    });
    return fail(provider);
  }

  try {
    const tokens = await def.validateAuthorizationCode(code, codeVerifier);
    const profile = await def.fetchUser(tokens);
    if (!profile) {
      console.error(`[oauth:${provider}] userinfo fetch failed`);
      return fail(provider);
    }

    // Linking flow: attach this identity to the already-signed-in user (no
    // session change). A stale link cookie without a session falls through to
    // normal sign-in.
    if (isLink) {
      const session = await getSession();
      if (session) {
        const linked = await linkOAuthAccount(session.userId, provider, profile);
        const dest = linked.ok
          ? `/app/settings/profile?linked=${provider}`
          : `/app/settings/profile?error=${provider}_taken`;
        return clearCookies(redirectTo(dest));
      }
    }

    const result = await resolveOAuthSession(provider, profile);
    if (!result.ok) {
      console.error(`[oauth:${provider}] resolve failed:`, result.error);
      return fail(result.error === "unverified" ? `${provider}_unverified` : provider);
    }

    const token = await sealSession(result.session);
    const res = redirectTo("/app");
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return clearCookies(res);
  } catch (e) {
    console.error(`[oauth:${provider}] token exchange / callback threw:`, e);
    return fail(provider);
  }
}
