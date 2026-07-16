import { cookies } from "next/headers";
import { createSession } from "@/lib/session";
import {
  googleClient,
  isGoogleConfigured,
  fetchGoogleUser,
  resolveGoogleSession,
} from "@/lib/oauth/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const to = (location: string) => new Response(null, { status: 302, headers: { Location: location } });

/**
 * Google OAuth callback: validate the state, exchange the code (with the PKCE
 * verifier), resolve the identity to a session and sign the user in. Any failure
 * bounces back to /login with an error.
 */
export async function GET(req: Request) {
  if (!isGoogleConfigured()) return to("/login?error=google");

  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");

  const jar = await cookies();
  const storedState = jar.get("google_oauth_state")?.value;
  const codeVerifier = jar.get("google_code_verifier")?.value;
  // One-time cookies — drop them whatever happens.
  jar.delete("google_oauth_state");
  jar.delete("google_code_verifier");

  if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
    return to("/login?error=google");
  }

  try {
    const tokens = await googleClient().validateAuthorizationCode(code, codeVerifier);
    const gu = await fetchGoogleUser(tokens.accessToken());
    if (!gu) return to("/login?error=google");

    const result = await resolveGoogleSession(gu);
    if (!result.ok) {
      return to(`/login?error=${result.error === "unverified" ? "google_unverified" : "google"}`);
    }

    await createSession(result.session);
    return to("/app");
  } catch (e) {
    console.error("[google-oauth] callback failed", e);
    return to("/login?error=google");
  }
}
