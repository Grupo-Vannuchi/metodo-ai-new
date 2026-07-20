import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type CompanyCard = {
  id: string;
  name: string;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
};

/** A folder column for the explorer. `id: null` is the "unfiled" column. */
export type CompanyColumn = {
  id: string | null;
  name: string;
  companies: CompanyCard[];
};

type Addr = { city?: string };

/** Folders + their companies, grouped into columns for the folder explorer.
 * The first column ("unfiled", id null) holds companies without a folder. */
export async function getCompaniesBoard(
  organizationId: string,
): Promise<{ folders: { id: string; name: string }[]; columns: CompanyColumn[] }> {
  const db = tenantDb(organizationId);

  const [folders, companies] = await Promise.all([
    db.companyFolder.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
    db.company.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, cnpj: true, email: true, phone: true, address: true, folderId: true },
    }),
  ]);

  const cardOf = (c: (typeof companies)[number]): CompanyCard => ({
    id: c.id,
    name: c.name,
    cnpj: c.cnpj,
    email: c.email,
    phone: c.phone,
    city: (c.address as Addr | null)?.city ?? null,
  });

  const byFolder = new Map<string | null, CompanyCard[]>();
  byFolder.set(null, []);
  for (const f of folders) byFolder.set(f.id, []);
  for (const c of companies) {
    const key = c.folderId && byFolder.has(c.folderId) ? c.folderId : null;
    byFolder.get(key)!.push(cardOf(c));
  }

  const columns: CompanyColumn[] = [
    { id: null, name: "", companies: byFolder.get(null)! },
    ...folders.map((f) => ({ id: f.id, name: f.name, companies: byFolder.get(f.id)! })),
  ];

  return { folders, columns };
}
