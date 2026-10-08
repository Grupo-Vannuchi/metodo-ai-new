import "server-only";
import { env } from "@/lib/env";

/**
 * The mass e-mail sends through the PLATFORM's Resend account — the same key
 * as login/invite/reset mail (src/lib/email/send.ts). Per-org Resend
 * connections (Conexões) are no longer used here; Campaigns still uses them.
 */
export function platformResendKey(): string | null {
  return env.RESEND_API_KEY?.trim() || null;
}

/** Delivery statuses work once the platform webhook secret is configured. */
export function deliveryTrackingConfigured(): boolean {
  return Boolean(env.RESEND_WEBHOOK_SECRET?.trim());
}
