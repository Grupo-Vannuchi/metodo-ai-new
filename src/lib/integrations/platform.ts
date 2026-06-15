import "server-only";
import { env } from "@/lib/env";
import type { Credentials } from "@/lib/integrations/crypto";

/**
 * Platform-managed credentials. When configured (via PLATFORM_* env vars), these
 * providers work for every tenant out-of-the-box — no per-user connection — used
 * as the fallback by the credential resolver. The returned shape matches what
 * the adapters expect (same keys as the provider's registry fields).
 *
 * Only providers that can be SHARED appear here. WhatsApp/SMTP/n8n are
 * identity-bound and are never platform-managed.
 */
export type PlatformProvider = "GOOGLE" | "RESEND";

export const PLATFORM_PROVIDERS: PlatformProvider[] = ["GOOGLE", "RESEND"];

export function getPlatformCredentials(
  provider: PlatformProvider,
): Credentials | null {
  if (provider === "GOOGLE") {
    if (!env.PLATFORM_GOOGLE_API_KEY) return null;
    return {
      apiKey: env.PLATFORM_GOOGLE_API_KEY,
      cseCx: env.PLATFORM_GOOGLE_CSE_CX ?? "",
    };
  }
  if (provider === "RESEND") {
    if (!env.PLATFORM_RESEND_API_KEY) return null;
    return {
      apiKey: env.PLATFORM_RESEND_API_KEY,
      fromEmail: env.PLATFORM_RESEND_FROM ?? "",
    };
  }
  return null;
}

export function isPlatformConfigured(provider: PlatformProvider): boolean {
  return getPlatformCredentials(provider) !== null;
}
