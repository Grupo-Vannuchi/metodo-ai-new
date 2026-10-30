import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { buildContactColumns, type ContactColumn } from "@/lib/crm/contact-folders-core";

export type { ContactCard, ContactColumn } from "@/lib/crm/contact-folders-core";

/** Folders + their contacts, grouped into columns for the drag-and-drop grid.
 * The first column ("unfiled", id null) holds contacts without a folder; a contact
 * in several folders appears in each. The board starts from contacts (org-scoped),
 * never from links, so a stray link can't pull in another company's contact. */
export async function getContactsBoard(
  organizationId: string,
): Promise<{ folders: { id: string; name: string }[]; columns: ContactColumn[] }> {
  const db = tenantDb(organizationId);

  const [folders, contacts] = await Promise.all([
    db.contactFolder.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
    db.contact.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        folderLinks: { select: { folderId: true } },
        company: { select: { name: true } },
      },
    }),
  ]);

  const columns = buildContactColumns(
    folders,
    contacts.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      companyName: c.company?.name ?? null,
      folderIds: c.folderLinks.map((l) => l.folderId),
    })),
  );

  return { folders, columns };
}

/** Per folder, how many contacts can receive e-mail (has an address, not opted out). A contact in
 * several folders counts once in each. Groups links (org-scoped by tenantDb), filtering on the contact. */
export async function contactFolderEmailCounts(organizationId: string): Promise<Map<string, number>> {
  const db = tenantDb(organizationId);
  const groups = await db.contactFolderLink.groupBy({
    by: ["folderId"],
    where: { contact: { email: { contains: "@" }, optedOut: false } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.folderId, g._count._all]));
}

/** Minimal folder options (for the contact form select). */
export async function contactFolderOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.contactFolder.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
}
