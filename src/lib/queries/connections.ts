import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { decryptCredentials } from "@/lib/integrations/crypto";
import { PROVIDERS, PROVIDER_KEYS, type IntegrationProviderKey } from "@/lib/integrations/registry";

/** Connections for the list view — never includes the encrypted credentials. */
export async function listConnections(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.integrationConnection.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      provider: true,
      label: true,
      status: true,
      lastTestAt: true,
    },
  });
}

/** How many active connections the org has (for plan limits). */
export function countConnections(organizationId: string): Promise<number> {
  const db = tenantDb(organizationId);
  return db.integrationConnection.count();
}

/** A single connection for the detail page (never includes credentials). */
export async function getConnection(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  return db.integrationConnection.findFirst({
    where: { id },
    select: { id: true, provider: true, label: true, status: true, lastTestAt: true },
  });
}

/**
 * A connection prepared for the edit form: label plus the NON-secret credential
 * values (so they can be prefilled). Password fields are never returned to the
 * client — the form leaves them blank and they're kept on save.
 */
export async function getConnectionForEdit(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  const conn = await db.integrationConnection.findFirst({
    where: { id },
    select: { id: true, provider: true, label: true, credentialsEnc: true },
  });
  if (!conn) return null;
  if (!PROVIDER_KEYS.includes(conn.provider as IntegrationProviderKey)) return null;

  const provider = conn.provider as IntegrationProviderKey;
  let decrypted: Record<string, string> = {};
  try {
    decrypted = decryptCredentials(conn.credentialsEnc);
  } catch {
    decrypted = {};
  }

  const credentials: Record<string, string> = {};
  for (const f of PROVIDERS[provider].fields) {
    if (f.type !== "password") credentials[f.key] = decrypted[f.key] ?? "";
  }

  return { id: conn.id, provider, label: conn.label, credentials };
}
