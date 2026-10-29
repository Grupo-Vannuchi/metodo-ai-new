import "server-only";
import type { tenantDb } from "@/lib/tenant-db";
import { mergeLinkPlan } from "@/lib/crm/contact-folders-core";

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

/** A folder argument: `null` ("Sem pasta") or a non-empty id. */
export function isFolderArg(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

/**
 * Moves contacts out of the folder `from` (the one open) into `to`, keeping
 * their other folders. `null` is "Sem pasta": as `to` it removes every link; as
 * `from` it just adds `to`. Returns null when `to` is not a folder of this
 * organization, or when `to`/`from` is neither null nor an id (an `undefined`
 * origin would reach `deleteMany` as "no folder filter" and wipe every link),
 * otherwise how many of this organization's contacts were moved.
 */
export async function moveContactsToFolder(
  db: Db,
  organizationId: string,
  ids: readonly string[],
  to: string | null,
  from: string | null,
): Promise<number | null> {
  if (!isFolderArg(to) || !isFolderArg(from)) return null;
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

/**
 * Adds contacts to `folderId`, keeping the folders they are already in. Returns
 * null when the folder is not one of this organization's, otherwise how many
 * links were new (contacts already there, or of another organization, count 0).
 */
export async function addContactsToFolder(
  db: Db,
  organizationId: string,
  ids: readonly string[],
  folderId: string,
): Promise<number | null> {
  const folder = await db.contactFolder.findFirst({ where: { id: folderId }, select: { id: true } });
  if (!folder) return null;

  const own = await ownContactIds(db, ids);
  if (own.length === 0) return 0;

  const res = await db.contactFolderLink.createMany({
    data: own.map((contactId) => ({ organizationId, contactId, folderId })),
    skipDuplicates: true,
  });
  return res.count;
}

/**
 * Takes contacts out of one folder only. A contact left with no folder falls
 * into "Sem pasta" by itself (the board derives it). Returns how many links
 * were deleted; a folder of another organization simply deletes 0.
 */
export async function removeContactsFromFolder(
  db: Db,
  ids: readonly string[],
  folderId: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await db.contactFolderLink.deleteMany({
    where: { contactId: { in: [...ids] }, folderId },
  });
  return res.count;
}

/**
 * Duplicate merge: the primary ends up in every folder any of the losers was
 * in. Links to a folder the primary already has (or that another loser already
 * brings) are deleted; the rest are repointed to the primary. Call it BEFORE
 * deleting the losers, or their links cascade away. The caller has already
 * proved that all the ids are contacts of this organization.
 */
export async function mergeContactFolderLinks(
  tx: Pick<Db, "contactFolderLink">,
  primaryId: string,
  loserIds: readonly string[],
): Promise<void> {
  if (loserIds.length === 0) return;
  const primaryFolderIds = (
    await tx.contactFolderLink.findMany({ where: { contactId: primaryId }, select: { folderId: true } })
  ).map((l) => l.folderId);
  const loserLinks = await tx.contactFolderLink.findMany({
    where: { contactId: { in: [...loserIds] } },
    select: { id: true, folderId: true },
    orderBy: { id: "asc" },
  });
  const { deleteIds, repointIds } = mergeLinkPlan(primaryFolderIds, loserLinks);
  if (deleteIds.length) await tx.contactFolderLink.deleteMany({ where: { id: { in: deleteIds } } });
  if (repointIds.length) {
    await tx.contactFolderLink.updateMany({ where: { id: { in: repointIds } }, data: { contactId: primaryId } });
  }
}
