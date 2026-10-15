import { NextResponse, type NextRequest } from "next/server";
import { decodeIdToken } from "arctic";
import { env } from "@/lib/env";
import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { audit } from "@/lib/audit";
import { accountKindFromTid, joinSiteUrl, microsoftConsentError } from "@/lib/email-broadcast/microsoft/core";
import {
  MS_MAIL_ORG_COOKIE,
  MS_MAIL_STATE_COOKIE,
  MS_MAIL_VERIFIER_COOKIE,
  microsoftMailClient,
  microsoftMailConfigured,
} from "@/lib/email-broadcast/microsoft/oauth";
import { graphMe } from "@/lib/email-broadcast/microsoft/graph";
import { saveMicrosoftAccount } from "@/lib/email-broadcast/microsoft/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Microsoft's redirect back after the consent (spec §5.1): check the session,
 * the state, the PKCE verifier and that the same org started the flow, then
 * save the mailbox. Tokens never reach the browser or the logs.
 */
export async function GET(req: NextRequest) {
  const site = env.NEXT_PUBLIC_SITE_URL;
  const back = (query: string) => {
    const res = NextResponse.redirect(joinSiteUrl(site, `/app/email/new?${query}`));
    res.cookies.delete(MS_MAIL_STATE_COOKIE);
    res.cookies.delete(MS_MAIL_VERIFIER_COOKIE);
    res.cookies.delete(MS_MAIL_ORG_COOKIE);
    return res;
  };

  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(joinSiteUrl(site, "/login"));
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!microsoftMailConfigured()) return back("microsoft_error=not_configured");

  const params = req.nextUrl.searchParams;
  const providerError = params.get("error");
  if (providerError) {
    return back(`microsoft_error=${microsoftConsentError(providerError, params.get("error_description") ?? "")}`);
  }

  const code = params.get("code");
  const state = params.get("state");
  const storedState = req.cookies.get(MS_MAIL_STATE_COOKIE)?.value;
  const verifier = req.cookies.get(MS_MAIL_VERIFIER_COOKIE)?.value;
  const startedOrg = req.cookies.get(MS_MAIL_ORG_COOKIE)?.value;
  if (!code || !state || !storedState || state !== storedState || !verifier || startedOrg !== ctx.organizationId) {
    console.error("[email-microsoft] callback state mismatch", {
      hasCode: Boolean(code),
      stateMatches: Boolean(state) && state === storedState,
      hasVerifier: Boolean(verifier),
      sameOrg: startedOrg === ctx.organizationId,
    });
    return back("microsoft_error=failed");
  }

  try {
    const tokens = await microsoftMailClient().validateAuthorizationCode(code, verifier);
    if (!tokens.hasRefreshToken()) return back("microsoft_error=failed");
    const claims = decodeIdToken(tokens.idToken()) as { tid?: unknown };
    const me = await graphMe(tokens.accessToken());
    if (!me.ok) {
      console.error("[email-microsoft] /me failed", me.message);
      return back("microsoft_error=failed");
    }
    const kind = accountKindFromTid(claims.tid);
    const saved = await saveMicrosoftAccount(ctx.organizationId, ctx.userId, {
      email: me.email,
      displayName: me.displayName,
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
      meta: { email: me.email, kind },
    });
    return back("microsoft=connected");
  } catch (error) {
    console.error("[email-microsoft] callback failed", error instanceof Error ? error.message : "unknown error");
    return back("microsoft_error=failed");
  }
}
