import { NextResponse } from "next/server";
import { generateCodeVerifier, generateState } from "arctic";
import { env } from "@/lib/env";
import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { joinSiteUrl } from "@/lib/email-broadcast/mailbox/core";
import {
  GG_MAIL_ORG_COOKIE,
  GG_MAIL_STATE_COOKIE,
  GG_MAIL_VERIFIER_COOKIE,
  GOOGLE_MAIL_SCOPES,
  googleMailClient,
  googleMailEnabledFor,
} from "@/lib/email-broadcast/google/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 10,
};

/**
 * Start connecting the org's Google account (spec 2026-10-19 §5). Same gates as
 * the E-mail screen, checked first, then the pilot: an org outside it gets
 * "not_configured" even with the URL typed by hand. The state, the PKCE verifier
 * and the org go in short cookies the callback checks.
 */
export async function GET() {
  const site = env.NEXT_PUBLIC_SITE_URL;
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(joinSiteUrl(site, "/login"));
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!googleMailEnabledFor(ctx.organizationId)) {
    return NextResponse.redirect(joinSiteUrl(site, "/app/email/new?google_error=not_configured"));
  }

  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = googleMailClient().createAuthorizationURL(state, verifier, GOOGLE_MAIL_SCOPES);
  // offline: Google only returns a refresh token for it; consent: asks again so the
  // refresh token comes on every connection; select_account: lets the user pick which account.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");

  const res = NextResponse.redirect(url);
  res.cookies.set(GG_MAIL_STATE_COOKIE, state, COOKIE_OPTS);
  res.cookies.set(GG_MAIL_VERIFIER_COOKIE, verifier, COOKIE_OPTS);
  res.cookies.set(GG_MAIL_ORG_COOKIE, ctx.organizationId, COOKIE_OPTS);
  return res;
}
