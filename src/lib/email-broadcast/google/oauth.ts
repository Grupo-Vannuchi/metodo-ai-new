import "server-only";
import { Google } from "arctic";
import { env } from "@/lib/env";
import { joinSiteUrl } from "../mailbox/core";
import { GMAIL_SEND_SCOPE, pilotAllows } from "./core";

/**
 * Scopes asked when a company connects its Google account (spec 2026-10-19):
 * identity plus send. Never a read scope. `access_type=offline` and
 * `prompt=consent select_account` are set on the authorization URL by the connect route.
 */
export const GOOGLE_MAIL_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  GMAIL_SEND_SCOPE,
];

/** Round-trip cookies of the connect flow (10 min). */
export const GG_MAIL_STATE_COOKIE = "gg_mail_state";
export const GG_MAIL_VERIFIER_COOKIE = "gg_mail_verifier";
export const GG_MAIL_ORG_COOKIE = "gg_mail_org";

export function googleMailConfigured(): boolean {
  return Boolean(env.GOOGLE_MAIL_CLIENT_ID && env.GOOGLE_MAIL_CLIENT_SECRET);
}

/** Registered in the Google Cloud project as an authorized redirect URI, without the double slash. */
export function googleMailCallbackUrl(): string {
  return joinSiteUrl(env.NEXT_PUBLIC_SITE_URL, "/api/email/google/callback");
}

export function googleMailClient(): Google {
  return new Google(
    env.GOOGLE_MAIL_CLIENT_ID as string,
    env.GOOGLE_MAIL_CLIENT_SECRET as string,
    googleMailCallbackUrl(),
  );
}

/** Configured and, while the app is in the pilot, listed in GOOGLE_MAIL_PILOT_ORG_IDS. */
export function googleMailEnabledFor(organizationId: string): boolean {
  return googleMailConfigured() && pilotAllows(organizationId, env.GOOGLE_MAIL_PILOT_ORG_IDS);
}
