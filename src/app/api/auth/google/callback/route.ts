import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sealSession, getSession } from "@/lib/session";
import {
  googleClient,
  isGoogleConfigured,
  fetchGoogleUser,
  resolveGoogleSession,
  linkGoogleAccount,
} from "@/lib/oauth/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Build a redirect to the PUBLIC site URL. `req.url` can't be trusted here:
 * behind the Hostinger/Passenger proxy it resolves to the internal bind address
 * (0.0.0.0:3000), producing broken redirects. */
const redirectTo = (path: string) => NextResponse.redirect(new URL(path, env.NEXT_PUBLIC_SITE_URL));

/** Wipe every OAuth round-trip cookie on a response (state, PKCE, link intent). */
function clearOAuthCookies(res: NextResponse): NextResponse {
  res.cookies.delete("google_oauth_state");
  res.cookies.delete("google_code_verifier");
  res.cookies.delete("google_link_intent");
  return res;
}

/**
 * Google OAuth callback: validate the state, exchange the code (with the PKCE
 * verifier), resolve the identity to a session and sign the user in — setting
 * cookies directly on the NextResponse. Any failure bounces back to /login with
 * an error (and logs why, for diagnosis).
 */
export async function GET(req: NextRequest) {
  // Linking flow (Conectar Google on the profile) vs. sign-in flow.
  const isLink = req.cookies.get("google_link_intent")?.value === "1";
  const backOnCancel = isLink ? "/app/settings/profile" : "/login";

  const fail = (code = "google") => {
    const dest = isLink ? `/app/settings/profile?error=${code}` : `/login?error=${code}`;
    return clearOAuthCookies(redirectTo(dest));
  };

  const params = req.nextUrl.searchParams;

  // The user dismissed Google's consent screen — not an error, just go back.
  if (params.get("error")) {
    return clearOAuthCookies(redirectTo(backOnCancel));
  }

  if (!isGoogleConfigured()) {
    console.error("[google-oauth] callback: not configured");
    return fail();
  }

  const code = params.get("code");
  const state = params.get("state");
  const storedState = req.cookies.get("google_oauth_state")?.value;
  const codeVerifier = req.cookies.get("google_code_verifier")?.value;

  if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
    console.error("[google-oauth] state/cookie mismatch", {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasStoredState: Boolean(storedState),
      stateMatches: state === storedState,
      hasVerifier: Boolean(codeVerifier),
    });
    return fail();
  }

  try {
    const tokens = await googleClient().validateAuthorizationCode(code, codeVerifier);
    const gu = await fetchGoogleUser(tokens.accessToken());
    if (!gu) {
      console.error("[google-oauth] userinfo fetch failed");
      return fail();
    }

    // Linking flow: attach this Google identity to the already-signed-in user
    // (no session change). A stale link cookie without a session falls through
    // to normal sign-in.
    if (isLink) {
      const session = await getSession();
      if (session) {
        const linked = await linkGoogleAccount(session.userId, gu);
        const dest = linked.ok
          ? "/app/settings/profile?linked=google"
          : "/app/settings/profile?error=google_taken";
        return clearOAuthCookies(redirectTo(dest));
      }
    }

    const result = await resolveGoogleSession(gu);
    if (!result.ok) {
      console.error("[google-oauth] resolve failed:", result.error);
      return fail(result.error === "unverified" ? "google_unverified" : "google");
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
    return clearOAuthCookies(res);
  } catch (e) {
    console.error("[google-oauth] token exchange / callback threw:", e);
    return fail();
  }
}
