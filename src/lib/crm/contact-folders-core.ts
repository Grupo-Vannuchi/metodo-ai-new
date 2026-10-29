/**
 * Pure rules for contacts that sit in several folders. No DB, no React, no
 * server-only: the folder explorer, the board query and the contact merge all
 * share it, and `npm run check:folders` exercises it.
 */

export type FolderColumn<T> = { id: string | null; name: string; items: T[] };
export type FolderDropMode = "move" | "add";

/**
 * Applies a drop of `ids` (taken from the `from` column) onto the `to` column.
 * Returns the very same `cols` array when nothing changes, so callers can
 * compare by reference and skip the server call.
 *
 * - `to === null` ("Sem pasta"): the items leave every folder column and go to
 *   the top of "Sem pasta" (no duplicates); `mode` is irrelevant.
 * - `to !== null`: the items not yet there go to the top of `to`. From
 *   "Sem pasta" they always leave it; from a folder they leave it only in
 *   "move" mode.
 */
export function applyFolderDrop<T extends { id: string }>(
  cols: FolderColumn<T>[],
  ids: readonly string[],
  from: string | null,
  to: string | null,
  mode: FolderDropMode,
): FolderColumn<T>[] {
  if (to === from) return cols;
  const source = cols.find((c) => c.id === from);
  if (!source) return cols;
  const wanted = new Set(ids);
  const moving = source.items.filter((i) => wanted.has(i.id));
  if (moving.length === 0) return cols;
  const movingIds = new Set(moving.map((i) => i.id));

  if (to === null) {
    return cols.map((c) => {
      if (c.id === null) {
        const rest = c.items.filter((i) => !movingIds.has(i.id));
        return { ...c, items: [...moving, ...rest] };
      }
      return { ...c, items: c.items.filter((i) => !movingIds.has(i.id)) };
    });
  }

  const leavesSource = from === null || mode === "move";
  return cols.map((c) => {
    if (c.id === to) {
      const present = new Set(c.items.map((i) => i.id));
      return { ...c, items: [...moving.filter((i) => !present.has(i.id)), ...c.items] };
    }
    if (c.id === from && leavesSource) {
      return { ...c, items: c.items.filter((i) => !movingIds.has(i.id)) };
    }
    return c;
  });
}

export type ContactCard = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  folderNames: string[];
};
export type ContactColumn = { id: string | null; name: string; contacts: ContactCard[] };
export type BoardContact = Omit<ContactCard, "folderNames"> & { folderIds: string[] };

/**
 * Builds the board: "Sem pasta" first (contacts with no existing folder), then
 * one column per folder, in the order given. A contact appears in every folder
 * it belongs to; `folderNames` follows the folders' order. Link ids that point
 * to no known folder are ignored.
 */
export function buildContactColumns(
  folders: { id: string; name: string }[],
  contacts: BoardContact[],
): ContactColumn[] {
  const known = new Map(folders.map((f) => [f.id, f.name]));
  const unfiled: ContactCard[] = [];
  const byFolder = new Map<string, ContactCard[]>(folders.map((f) => [f.id, []]));
  for (const c of contacts) {
    const own = new Set(c.folderIds.filter((id) => known.has(id)));
    const { folderIds: _folderIds, ...rest } = c;
    void _folderIds;
    const card: ContactCard = {
      ...rest,
      folderNames: folders.filter((f) => own.has(f.id)).map((f) => f.name),
    };
    if (own.size === 0) unfiled.push(card);
    else for (const id of own) byFolder.get(id)!.push(card);
  }
  return [
    { id: null, name: "", contacts: unfiled },
    ...folders.map((f) => ({ id: f.id, name: f.name, contacts: byFolder.get(f.id)! })),
  ];
}

/**
 * Plan for the folder links of a merged-away contact: a link to a folder the
 * primary already has (or that an earlier loser link already takes) is
 * deleted; the others are repointed to the primary.
 */
export function mergeLinkPlan(
  primaryFolderIds: readonly string[],
  loserLinks: readonly { id: string; folderId: string }[],
): { deleteIds: string[]; repointIds: string[] } {
  const taken = new Set(primaryFolderIds);
  const deleteIds: string[] = [];
  const repointIds: string[] = [];
  for (const link of loserLinks) {
    if (taken.has(link.folderId)) {
      deleteIds.push(link.id);
    } else {
      taken.add(link.folderId);
      repointIds.push(link.id);
    }
  }
  return { deleteIds, repointIds };
}
