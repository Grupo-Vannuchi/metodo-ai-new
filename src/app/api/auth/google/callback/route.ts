import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sealSession } from "@/lib/session";
import {
  googleClient,
  isGoogleConfigured,
  fetchGoogleUser,
  resolveGoogleSession,
} from "@/lib/oauth/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Build a redirect to the PUBLIC site URL. `req.url` can't be trusted here:
 * behind the Hostinger/Passenger proxy it resolves to the internal bind address
 * (0.0.0.0:3000), producing broken redirects. */
const redirectTo = (path: string) => NextResponse.redirect(new URL(path, env.NEXT_PUBLIC_SITE_URL));

/**
 * Google OAuth callback: validate the state, exchange the code (with the PKCE
 * verifier), resolve the identity to a session and sign the user in — setting
 * cookies directly on the NextResponse. Any failure bounces back to /login with
 * an error (and logs why, for diagnosis).
 */
export async function GET(req: NextRequest) {
  const fail = (code = "google") => {
    const res = redirectTo(`/login?error=${code}`);
    res.cookies.delete("google_oauth_state");
    res.cookies.delete("google_code_verifier");
    return res;
  };

  const params = req.nextUrl.searchParams;

  // The user dismissed Google's consent screen — not an error, just go back.
  if (params.get("error")) {
    const res = redirectTo("/login");
    res.cookies.delete("google_oauth_state");
    res.cookies.delete("google_code_verifier");
    return res;
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
    res.cookies.delete("google_oauth_state");
    res.cookies.delete("google_code_verifier");
    return res;
  } catch (e) {
    console.error("[google-oauth] token exchange / callback threw:", e);
    return fail();
  }
}
