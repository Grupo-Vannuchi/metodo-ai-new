import { NextResponse } from "next/server";
import { generateState, generateCodeVerifier } from "arctic";
import { env } from "@/lib/env";
import { googleClient, isGoogleConfigured } from "@/lib/oauth/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 10, // 10 min to complete the round-trip
};

/** Start the Google OAuth flow: stash a state + PKCE verifier in cookies (set on
 * the NextResponse so they reliably persist) and bounce to Google. */
export async function GET() {
  if (!isGoogleConfigured()) {
    console.error("[google-oauth] start: GOOGLE_CLIENT_ID/SECRET not configured");
    // Public site URL, not req.url — the latter is the internal proxy address.
    return NextResponse.redirect(new URL("/login?error=google", env.NEXT_PUBLIC_SITE_URL));
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = googleClient().createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]);

  const res = NextResponse.redirect(url);
  res.cookies.set("google_oauth_state", state, COOKIE_OPTS);
  res.cookies.set("google_code_verifier", codeVerifier, COOKIE_OPTS);
  return res;
}
