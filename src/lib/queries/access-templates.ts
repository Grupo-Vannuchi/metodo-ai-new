import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/** Access templates with how many members use each. */
export async function listAccessTemplates(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.accessTemplate.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      screens: true,
      _count: { select: { memberships: true } },
    },
  });
}

/** Minimal options for the per-member template selector. */
export async function accessTemplateOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.accessTemplate.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
