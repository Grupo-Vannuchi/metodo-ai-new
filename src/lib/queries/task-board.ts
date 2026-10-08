import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import type { BoardColumn } from "@/lib/tasks/board-core";

/** The org's kanban columns, left to right. */
export async function listTaskBoardColumns(organizationId: string): Promise<BoardColumn[]> {
  return tenantDb(organizationId).taskBoardColumn.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, order: true, isEntrance: true },
  });
}
