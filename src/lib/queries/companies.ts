import "server-only";
import { tenantDb } from "@/lib/tenant-db";

type Addr = { city?: string };

export async function listCompanies(organizationId: string, page = 1, pageSize = 10) {
  const db = tenantDb(organizationId);
  const [total, rows] = await Promise.all([
    db.company.count(),
    db.company.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        cnpj: true,
        email: true,
        phone: true,
        address: true,
      },
    }),
  ]);

  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    cnpj: r.cnpj,
    email: r.email,
    phone: r.phone,
    city: (r.address as Addr)?.city ?? "",
  }));

  return { data, total };
}

/** Full company for the view/edit pages. Scoped: returns null if not in this org. */
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
      source: true,
      createdAt: true,
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
