import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export async function listContacts(organizationId: string) {
  const db = tenantDb(organizationId);
  const rows = await db.contact.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      tags: true,
      company: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    tags: r.tags,
    companyName: r.company?.name ?? null,
  }));
}

/** Full contact for the view/edit pages. Scoped: returns null if not in this org. */
export async function getContact(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  return db.contact.findFirst({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      companyId: true,
      tags: true,
      optedOut: true,
      source: true,
      createdAt: true,
      company: { select: { name: true } },
    },
  });
}

export async function contactOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.contact.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
