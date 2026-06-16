import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export async function listExtractionJobs(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.extractionJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      query: true,
      status: true,
      total: true,
      target: true,
      error: true,
      createdAt: true,
    },
  });
}

/** A job with its leads, for the results page. Scoped: null if not in org. */
export async function getExtractionJob(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  const job = await db.extractionJob.findFirst({
    where: { id },
    select: { id: true, query: true, status: true, total: true, target: true, error: true },
  });
  if (!job) return null;

  const leads = await db.extractedLead.findMany({
    where: { jobId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      segment: true,
      address: true,
      phone: true,
      whatsapp: true,
      email: true,
      website: true,
      instagram: true,
      facebook: true,
      linkedin: true,
      rating: true,
      importedCompanyId: true,
      importedAt: true,
    },
  });

  return { job, leads };
}

/** Leads extracted since `since` (for the monthly prospecting quota). */
export function countLeadsSince(organizationId: string, since: Date): Promise<number> {
  const db = tenantDb(organizationId);
  return db.extractedLead.count({ where: { createdAt: { gte: since } } });
}
