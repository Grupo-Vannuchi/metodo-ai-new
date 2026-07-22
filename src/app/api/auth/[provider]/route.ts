import { NextResponse, type NextRequest } from "next/server";
import { generateState, generateCodeVerifier } from "arctic";
import { env } from "@/lib/env";
import { OAUTH } from "@/lib/oauth/providers";
import { isOAuthProvider } from "@/lib/oauth/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 10, // 10 min to complete the round-trip
};

/**
 * Start an OAuth flow for `[provider]`: stash a state + PKCE verifier in cookies
 * (set on the NextResponse so they reliably persist) and bounce to the provider.
 * With `?intent=link` the callback attaches the identity to the signed-in user
 * instead of logging in (the "Conectar" buttons on the profile).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const link = req.nextUrl.searchParams.get("intent") === "link";

  // Public site URL, not req.url — the latter is the internal proxy address.
  const back = (code: string) =>
    NextResponse.redirect(
      new URL(
        link ? `/app/settings/profile?error=${code}` : `/login?error=${code}`,
        env.NEXT_PUBLIC_SITE_URL,
      ),
    );

  if (!isOAuthProvider(provider)) return back("oauth");

  const def = OAUTH[provider];
  if (!def.isConfigured()) {
    console.error(`[oauth:${provider}] start: client id/secret not configured`);
    return back(provider);
  }

  const state = generateState();
  // Always generated; providers without PKCE (LinkedIn) ignore it.
  const codeVerifier = generateCodeVerifier();

  const res = NextResponse.redirect(def.createAuthorizationURL(state, codeVerifier));
  res.cookies.set(`${provider}_oauth_state`, state, COOKIE_OPTS);
  res.cookies.set(`${provider}_code_verifier`, codeVerifier, COOKIE_OPTS);
  if (link) res.cookies.set(`${provider}_link_intent`, "1", COOKIE_OPTS);
  return res;
}
