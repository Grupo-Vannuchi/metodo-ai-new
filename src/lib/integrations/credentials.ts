import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptCredentials, type Credentials } from "@/lib/integrations/crypto";
import {
  getPlatformCredentials,
  type PlatformProvider,
} from "@/lib/integrations/platform";

export type ResolvedCredentials = {
  source: "tenant" | "platform";
  credentials: Credentials;
};

/**
 * Resolve credentials for a shareable provider: the tenant's own connection
 * takes precedence; otherwise fall back to the platform-managed credentials;
 * otherwise null. Uses raw prisma (with explicit `organizationId`) so it works
 * in system contexts such as the extraction runner.
 */
export async function resolveCredentials(
  organizationId: string,
  provider: PlatformProvider,
): Promise<ResolvedCredentials | null> {
  const conn = await prisma.integrationConnection.findFirst({
    where: { organizationId, provider },
    orderBy: { createdAt: "desc" },
  });
  if (conn) {
    try {
      return { source: "tenant", credentials: decryptCredentials(conn.credentialsEnc) };
    } catch {
      // Corrupt tenant credentials — fall through to platform default.
    }
  }
  const platform = getPlatformCredentials(provider);
  if (platform) return { source: "platform", credentials: platform };
  return null;
}

/** Whether the org has its OWN connection for a provider (ignores platform). */
export async function hasOwnConnection(
  organizationId: string,
  provider: PlatformProvider,
): Promise<boolean> {
  const count = await prisma.integrationConnection.count({
    where: { organizationId, provider },
  });
  return count > 0;
}
