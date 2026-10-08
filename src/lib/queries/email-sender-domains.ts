import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/** Sender domains the platform team assigned to this org (scripts/email-domain.ts). */
export async function listSenderDomains(organizationId: string): Promise<string[]> {
  const rows = await tenantDb(organizationId).emailSenderDomain.findMany({
    orderBy: { domain: "asc" },
    select: { domain: true },
  });
  return rows.map((r) => r.domain);
}
