import "server-only";
import type { tenantDb } from "@/lib/tenant-db";

/**
 * Writes to the contact ↔ folder links (a contact can sit in several folders).
 *
 * The database foreign keys do NOT check that a link's organization matches its
 * contact's or folder's, so everything here proves ownership first: the target
 * folder through `db.contactFolder.findFirst` and the contact ids through
 * `ownContactIds`, both scoped to the organization by `tenantDb`.
 */

type Db = ReturnType<typeof tenantDb>;

/** The subset of `ids` that are contacts of this organization. */
export async function ownContactIds(db: Db, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.contact.findMany({ where: { id: { in: [...ids] } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Moves contacts out of the folder `from` (the one open) into `to`, keeping
 * their other folders. `null` is "Sem pasta": as `to` it removes every link; as
 * `from` it just adds `to`. Returns null when `to` is not a folder of this
 * organization, otherwise how many of this organization's contacts were moved.
 */
export async function moveContactsToFolder(
  db: Db,
  organizationId: string,
  ids: readonly string[],
  to: string | null,
  from: string | null,
): Promise<number | null> {
  if (to !== null) {
    const folder = await db.contactFolder.findFirst({ where: { id: to }, select: { id: true } });
    if (!folder) return null;
  }
  if (to === from) return 0;

  const own = await ownContactIds(db, ids);
  if (own.length === 0) return 0;

  await db.$transaction(async (tx) => {
    if (to === null) {
      await tx.contactFolderLink.deleteMany({ where: { contactId: { in: own } } });
      return;
    }
    await tx.contactFolderLink.createMany({
      data: own.map((contactId) => ({ organizationId, contactId, folderId: to })),
      skipDuplicates: true,
    });
    if (from !== null) {
      await tx.contactFolderLink.deleteMany({ where: { contactId: { in: own }, folderId: from } });
    }
  });
  return own.length;
}
