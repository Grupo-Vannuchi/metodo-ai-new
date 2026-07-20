import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptCredentials, type Credentials } from "@/lib/integrations/crypto";
import type { EvoCreds } from "@/lib/integrations/evolution-client";
import { env } from "@/lib/env";

/**
 * Resolve an EVOLUTION connection's effective credentials. A connection stores
 * only what it overrides:
 *  - **Platform connections** (the one-click WhatsApp flow) store just the
 *    `instance`; the base URL + API key come from the shared platform env
 *    (`EVOLUTION_API_URL` / `EVOLUTION_API_KEY`).
 *  - **BYO connections** (advanced) store their own `baseUrl` + `apiKey` and use
 *    those instead.
 * So one shared Evolution server serves every tenant, split by instance, while
 * legacy per-tenant keys keep working.
 */
export function resolveEvoCreds(c: Credentials): EvoCreds | null {
  const baseUrl = c.baseUrl || env.EVOLUTION_API_URL;
  const apiKey = c.apiKey || env.EVOLUTION_API_KEY;
  const instance = c.instance;
  if (!baseUrl || !apiKey || !instance) return null;
  return { baseUrl, apiKey, instance };
}

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
    return resolveEvoCreds(decryptCredentials(conn.credentialsEnc));
  } catch {
    return null;
  }
}
