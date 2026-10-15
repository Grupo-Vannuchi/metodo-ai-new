import "server-only";
import { MicrosoftEntraId } from "arctic";
import { env } from "@/lib/env";
import { joinSiteUrl } from "./core";

/** Delegated scopes asked when a company connects its mailbox (spec 2026-10-15 §5.1). */
export const MICROSOFT_MAIL_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Send",
  "Mail.ReadWrite",
];

/** Round-trip cookies of the connect flow (10 min). */
export const MS_MAIL_STATE_COOKIE = "ms_mail_state";
export const MS_MAIL_VERIFIER_COOKIE = "ms_mail_verifier";
export const MS_MAIL_ORG_COOKIE = "ms_mail_org";

export function microsoftMailConfigured(): boolean {
  return Boolean(env.MICROSOFT_MAIL_CLIENT_ID && env.MICROSOFT_MAIL_CLIENT_SECRET);
}

/** Registered in the app as a Web redirect URI, without the double slash. */
export function microsoftMailCallbackUrl(): string {
  return joinSiteUrl(env.NEXT_PUBLIC_SITE_URL, "/api/email/microsoft/callback");
}

/** "common": personal Microsoft accounts and any Microsoft 365 tenant. */
export function microsoftMailClient(): MicrosoftEntraId {
  return new MicrosoftEntraId(
    "common",
    env.MICROSOFT_MAIL_CLIENT_ID as string,
    env.MICROSOFT_MAIL_CLIENT_SECRET as string,
    microsoftMailCallbackUrl(),
  );
}
