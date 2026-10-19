import { NextResponse } from "next/server";
import { generateCodeVerifier, generateState } from "arctic";
import { env } from "@/lib/env";
import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { joinSiteUrl } from "@/lib/email-broadcast/mailbox/core";
import {
  MICROSOFT_MAIL_SCOPES,
  MS_MAIL_ORG_COOKIE,
  MS_MAIL_STATE_COOKIE,
  MS_MAIL_VERIFIER_COOKIE,
  microsoftMailClient,
  microsoftMailConfigured,
} from "@/lib/email-broadcast/microsoft/oauth";

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
 * Start connecting the org's Microsoft mailbox (spec 2026-10-15 §5.1). Same
 * gates as the E-mail screen, checked first. The state, the PKCE verifier and
 * the org go in short cookies the callback checks.
 */
export async function GET() {
  const site = env.NEXT_PUBLIC_SITE_URL;
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(joinSiteUrl(site, "/login"));
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!microsoftMailConfigured()) {
    return NextResponse.redirect(joinSiteUrl(site, "/app/email/new?microsoft_error=not_configured"));
  }

  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = microsoftMailClient().createAuthorizationURL(state, verifier, MICROSOFT_MAIL_SCOPES);
  url.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(url);
  res.cookies.set(MS_MAIL_STATE_COOKIE, state, COOKIE_OPTS);
  res.cookies.set(MS_MAIL_VERIFIER_COOKIE, verifier, COOKIE_OPTS);
  res.cookies.set(MS_MAIL_ORG_COOKIE, ctx.organizationId, COOKIE_OPTS);
  return res;
}
