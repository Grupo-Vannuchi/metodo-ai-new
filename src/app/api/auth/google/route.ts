import { NextResponse, type NextRequest } from "next/server";
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
 * the NextResponse so they reliably persist) and bounce to Google. With
 * `?intent=link` the callback attaches the Google identity to the signed-in
 * user instead of logging in (the "Conectar Google" button on the profile). */
export async function GET(req: NextRequest) {
  const link = req.nextUrl.searchParams.get("intent") === "link";

  if (!isGoogleConfigured()) {
    console.error("[google-oauth] start: GOOGLE_CLIENT_ID/SECRET not configured");
    // Public site URL, not req.url — the latter is the internal proxy address.
    const back = link ? "/app/settings/profile?error=google" : "/login?error=google";
    return NextResponse.redirect(new URL(back, env.NEXT_PUBLIC_SITE_URL));
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = googleClient().createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]);

  const res = NextResponse.redirect(url);
  res.cookies.set("google_oauth_state", state, COOKIE_OPTS);
  res.cookies.set("google_code_verifier", codeVerifier, COOKIE_OPTS);
  if (link) res.cookies.set("google_link_intent", "1", COOKIE_OPTS);
  return res;
}
