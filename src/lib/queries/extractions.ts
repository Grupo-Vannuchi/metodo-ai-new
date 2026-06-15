import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/**
 * Count Google extractions this org ran since `since` — the proxy for
 * platform-paid usage when enforcing the monthly extraction quota.
 */
export function countGoogleExtractionsSince(
  organizationId: string,
  since: Date,
): Promise<number> {
  const db = tenantDb(organizationId);
  return db.extractionJob.count({
    where: {
      provider: { in: ["GOOGLE_MAPS", "GOOGLE_CSE"] },
      createdAt: { gte: since },
    },
  });
}

export async function listExtractions(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.extractionJob.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      provider: true,
      status: true,
      totalFound: true,
      createdAt: true,
    },
  });
}

/** A job with its leads, for the detail page. Scoped to the org. */
export async function getExtraction(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  const job = await db.extractionJob.findFirst({
    where: { id },
    select: {
      id: true,
      provider: true,
      status: true,
      totalFound: true,
      error: true,
      params: true,
      createdAt: true,
    },
  });
  if (!job) return null;

  const leads = await db.extractedLead.findMany({
    where: { extractionJobId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      cnpj: true,
      email: true,
      phone: true,
      importedCompanyId: true,
      importedAt: true,
    },
  });

  return { job, leads };
}
