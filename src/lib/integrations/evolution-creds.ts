import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptCredentials } from "@/lib/integrations/crypto";
import type { EvoCreds } from "@/lib/integrations/evolution-client";

/**
 * Load + decrypt an EVOLUTION connection's credentials by id. Unlike the
 * org-scoped action helper, this is for trusted server contexts (webhook jobs)
 * where the org boundary is already established by the connection itself.
 */
export async function loadEvoCredsById(connectionId: string): Promise<EvoCreds | null> {
  const conn = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, provider: "EVOLUTION" },
    select: { credentialsEnc: true },
  });
  if (!conn) return null;
  try {
    const c = decryptCredentials(conn.credentialsEnc);
    if (!c.baseUrl || !c.apiKey || !c.instance) return null;
    return { baseUrl: c.baseUrl, apiKey: c.apiKey, instance: c.instance };
  } catch {
    return null;
  }
}
