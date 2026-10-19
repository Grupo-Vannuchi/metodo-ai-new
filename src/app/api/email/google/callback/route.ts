import { NextResponse, type NextRequest } from "next/server";
import { decodeIdToken } from "arctic";
import { env } from "@/lib/env";
import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { audit } from "@/lib/audit";
import { joinSiteUrl } from "@/lib/email-broadcast/mailbox/core";
import {
  googleAccountKind,
  googleConsentError,
  googleGrantedSend,
  googleHasGmail,
} from "@/lib/email-broadcast/google/core";
import {
  GG_MAIL_ORG_COOKIE,
  GG_MAIL_STATE_COOKIE,
  GG_MAIL_VERIFIER_COOKIE,
  googleMailClient,
  googleMailEnabledFor,
} from "@/lib/email-broadcast/google/oauth";
import { saveGoogleAccount } from "@/lib/email-broadcast/google/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google's redirect back after the consent (spec 2026-10-19 §5): check the
 * session, the pilot, the state, the PKCE verifier and that the same org started
 * the flow, then check the grant (send scope, refresh token, verified address
 * with a Gmail mailbox) before saving the account. Tokens never reach the
 * browser or the logs.
 */
export async function GET(req: NextRequest) {
  const site = env.NEXT_PUBLIC_SITE_URL;
  const back = (query: string) => {
    const res = NextResponse.redirect(joinSiteUrl(site, `/app/email/new?${query}`));
    res.cookies.delete(GG_MAIL_STATE_COOKIE);
    res.cookies.delete(GG_MAIL_VERIFIER_COOKIE);
    res.cookies.delete(GG_MAIL_ORG_COOKIE);
    return res;
  };

  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(joinSiteUrl(site, "/login"));
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!googleMailEnabledFor(ctx.organizationId)) return back("google_error=not_configured");

  const params = req.nextUrl.searchParams;
  const providerError = params.get("error");
  if (providerError) return back(`google_error=${googleConsentError(providerError)}`);

  const code = params.get("code");
  const state = params.get("state");
  const storedState = req.cookies.get(GG_MAIL_STATE_COOKIE)?.value;
  const verifier = req.cookies.get(GG_MAIL_VERIFIER_COOKIE)?.value;
  const startedOrg = req.cookies.get(GG_MAIL_ORG_COOKIE)?.value;
  if (!code || !state || !storedState || state !== storedState || !verifier || startedOrg !== ctx.organizationId) {
    console.error("[email-google] callback state mismatch", {
      hasCode: Boolean(code),
      stateMatches: Boolean(state) && state === storedState,
      hasVerifier: Boolean(verifier),
      sameOrg: startedOrg === ctx.organizationId,
    });
    return back("google_error=failed");
  }

  try {
    const tokens = await googleMailClient().validateAuthorizationCode(code, verifier);
    // The user can untick the send permission on the consent screen.
    if (!googleGrantedSend(tokens.hasScopes() ? tokens.scopes() : [])) return back("google_error=missing_send");
    if (!tokens.hasRefreshToken()) {
      console.error("[email-google] consent returned no refresh token");
      return back("google_error=failed");
    }

    const claims = decodeIdToken(tokens.idToken()) as {
      email?: unknown;
      email_verified?: unknown;
      name?: unknown;
      hd?: unknown;
    };
    if (typeof claims.email !== "string" || claims.email.trim() === "" || claims.email_verified !== true) {
      console.error("[email-google] id token without a verified address");
      return back("google_error=failed");
    }
    const email = claims.email.trim().toLowerCase();
    if (!googleHasGmail(email, claims.hd)) return back("google_error=no_gmail");

    const kind = googleAccountKind(claims.hd);
    const displayName = typeof claims.name === "string" && claims.name.trim() !== "" ? claims.name.trim() : null;
    const saved = await saveGoogleAccount(ctx.organizationId, ctx.userId, {
      email,
      displayName,
      accountKind: kind,
      credentials: {
        accessToken: tokens.accessToken(),
        refreshToken: tokens.refreshToken(),
        expiresAt: tokens.accessTokenExpiresAt().toISOString(),
      },
    });
    await audit(ctx, {
      action: saved.replaced ? "email_sender.replaced" : "email_sender.connected",
      entity: "EmailSenderAccount",
      entityId: saved.id,
      meta: { email, kind, provider: "GOOGLE" },
    });
    return back("google=connected");
  } catch (error) {
    console.error("[email-google] callback failed", error instanceof Error ? error.message : "unknown error");
    return back("google_error=failed");
  }
}
