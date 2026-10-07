import "server-only";
import { env } from "@/lib/env";
import { hmacHex, safeEqual } from "./signing";

/**
 * Unsubscribe links of the mass e-mail. Signed per RECIPIENT row (which
 * carries the org and the address), domain-separated from the Campaigns
 * opt-out HMAC in src/lib/unsubscribe.ts — which stays untouched.
 */
const SIG_PREFIX = "email-broadcast-unsub:";

export function emailUnsubscribeSig(recipientId: string): string {
  return hmacHex(env.SESSION_SECRET, SIG_PREFIX + recipientId);
}

export function verifyEmailUnsubscribeSig(recipientId: string, sig: string): boolean {
  return safeEqual(emailUnsubscribeSig(recipientId), sig);
}

function siteBase(): string {
  return env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
}

/** Footer link: a page with a confirm button (a GET alone never unsubscribes). */
export function emailUnsubscribePageUrl(recipientId: string): string {
  return `${siteBase()}/email-unsubscribe/${recipientId}/${emailUnsubscribeSig(recipientId)}`;
}

/** RFC 8058 one-click target for the List-Unsubscribe header (POST only). */
export function emailUnsubscribeOneClickUrl(recipientId: string): string {
  return `${siteBase()}/api/email/unsubscribe/${recipientId}/${emailUnsubscribeSig(recipientId)}`;
}
