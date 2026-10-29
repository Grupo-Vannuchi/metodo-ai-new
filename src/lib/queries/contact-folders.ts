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

/** Minimal folder options (for the contact form select). */
export async function contactFolderOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.contactFolder.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
}
