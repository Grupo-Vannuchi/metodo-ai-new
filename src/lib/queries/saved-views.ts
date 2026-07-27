import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type SavedViewRow = { id: string; name: string; query: string };

/** A user's saved filter presets for a board (scope), in display order. */
export async function listSavedViews(
  organizationId: string,
  userId: string,
  scope = "crm",
): Promise<SavedViewRow[]> {
  const db = tenantDb(organizationId);
  return db.savedView.findMany({
    where: { userId, scope },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, query: true },
  });
}
