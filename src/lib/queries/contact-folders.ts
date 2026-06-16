import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type ContactCard = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
};

/** A folder column for the grid view. `id: null` is the "unfiled" column. */
export type ContactColumn = {
  id: string | null;
  name: string;
  contacts: ContactCard[];
};

/** Folders + their contacts, grouped into columns for the drag-and-drop grid.
 * The first column ("unfiled", id null) holds contacts without a folder. */
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
        folderId: true,
        company: { select: { name: true } },
      },
    }),
  ]);

  const cardOf = (c: (typeof contacts)[number]): ContactCard => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    companyName: c.company?.name ?? null,
  });

  const byFolder = new Map<string | null, ContactCard[]>();
  byFolder.set(null, []);
  for (const f of folders) byFolder.set(f.id, []);
  for (const c of contacts) {
    const key = c.folderId && byFolder.has(c.folderId) ? c.folderId : null;
    byFolder.get(key)!.push(cardOf(c));
  }

  const columns: ContactColumn[] = [
    { id: null, name: "", contacts: byFolder.get(null)! },
    ...folders.map((f) => ({ id: f.id, name: f.name, contacts: byFolder.get(f.id)! })),
  ];

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
