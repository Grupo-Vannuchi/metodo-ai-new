import "server-only";
import { tenantDb } from "@/lib/tenant-db";

type Addr = { city?: string };

export async function listCompanies(organizationId: string) {
  const db = tenantDb(organizationId);
  const rows = await db.company.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      cnpj: true,
      email: true,
      phone: true,
      address: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    cnpj: r.cnpj,
    email: r.email,
    phone: r.phone,
    city: (r.address as Addr)?.city ?? "",
  }));
}

/** Full company for the edit page. Scoped: returns null if not in this org. */
export async function getCompany(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  return db.company.findFirst({
    where: { id },
    select: {
      id: true,
      name: true,
      cnpj: true,
      email: true,
      phone: true,
      website: true,
      address: true,
      notes: true,
    },
  });
}

/** Lightweight options for company selects. */
export async function companyOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.company.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
