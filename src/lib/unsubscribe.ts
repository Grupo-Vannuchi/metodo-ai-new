import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

/**
 * Stateless unsubscribe tokens: a contact's opt-out link carries an HMAC of its
 * id (keyed by SESSION_SECRET), so no per-contact token needs to be stored and
 * the link can't be forged.
 */
export function unsubscribeSig(contactId: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(contactId).digest("hex");
}

export function verifyUnsubscribeSig(contactId: string, sig: string): boolean {
  const expected = unsubscribeSig(contactId);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Absolute unsubscribe URL (default locale, no prefix). */
export function unsubscribeUrl(contactId: string): string {
  return `${env.NEXT_PUBLIC_SITE_URL}/unsubscribe/${contactId}/${unsubscribeSig(contactId)}`;
}
