import { cookies } from "next/headers";
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

/** Start the Google OAuth flow: stash a state + PKCE verifier in cookies and
 * bounce to Google's consent screen. */
export async function GET() {
  if (!isGoogleConfigured()) {
    return new Response(null, { status: 302, headers: { Location: "/login?error=google" } });
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = googleClient().createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]);

  const jar = await cookies();
  jar.set("google_oauth_state", state, COOKIE_OPTS);
  jar.set("google_code_verifier", codeVerifier, COOKIE_OPTS);

  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}
