import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import type { ExportTable } from "@/lib/export/table";

/** Tabular export data for the CRM (contacts and companies). */

export async function getContactsExport(organizationId: string): Promise<ExportTable> {
  const db = tenantDb(organizationId);
  const contacts = await db.contact.findMany({
    orderBy: { name: "asc" },
    take: 10000,
    select: {
      name: true,
      email: true,
      phone: true,
      role: true,
      tags: true,
      company: { select: { name: true } },
    },
  });
  return {
    title: "Contatos",
    headers: ["Nome", "E-mail", "Telefone", "Cargo", "Empresa", "Tags"],
    rows: contacts.map((c) => [
      c.name ?? "",
      c.email ?? "",
      c.phone ?? "",
      c.role ?? "",
      c.company?.name ?? "",
      (c.tags ?? []).join(", "),
    ]),
  };
}

type Addr = { street?: string; city?: string; uf?: string; zip?: string };

export async function getCompaniesExport(organizationId: string): Promise<ExportTable> {
  const db = tenantDb(organizationId);
  const companies = await db.company.findMany({
    orderBy: { name: "asc" },
    take: 10000,
    select: { name: true, cnpj: true, email: true, phone: true, website: true, address: true },
  });
  return {
    title: "Empresas",
    headers: ["Nome", "CNPJ", "E-mail", "Telefone", "Site", "Cidade", "UF"],
    rows: companies.map((c) => {
      const addr = (c.address ?? {}) as Addr;
      return [
        c.name ?? "",
        c.cnpj ?? "",
        c.email ?? "",
        c.phone ?? "",
        c.website ?? "",
        addr.city ?? "",
        addr.uf ?? "",
      ];
    }),
  };
}
