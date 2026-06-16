import "server-only";
import { env } from "@/lib/env";
import type { Credentials } from "@/lib/integrations/crypto";

/**
 * Platform-managed credentials. When configured (via PLATFORM_* env vars), the
 * provider works for every tenant out-of-the-box — used as the fallback by the
 * credential resolver. Only shareable providers appear here (email). WhatsApp is
 * identity-bound and never platform-managed.
 */
export type PlatformProvider = "RESEND";

export const PLATFORM_PROVIDERS: PlatformProvider[] = ["RESEND"];

export function getPlatformCredentials(
  provider: PlatformProvider,
): Credentials | null {
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
