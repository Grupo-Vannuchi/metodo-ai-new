import "server-only";
import { tenantDb } from "@/lib/tenant-db";

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
