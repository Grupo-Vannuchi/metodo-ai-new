"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext, type OrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { LIMITS } from "@/config/limits";
import { audit } from "@/lib/audit";
import { compareBoardCards, normalizeColumnName, ORDER_STEP, orderForInsert } from "@/lib/tasks/board-core";

export type TaskBoardError = "unauthorized" | "forbidden" | "invalid" | "not_found" | "limit" | "entrance" | "unknown";
export type TaskBoardResult = { ok: true } | { ok: false; error: TaskBoardError };

type Gate = { ok: true; ctx: OrgContext } | { ok: false; error: TaskBoardError };

/** Session + the "tasks" screen + the Tasks module — the route layout's gates,
 * repeated because server actions are public endpoints. */
async function gate(): Promise<Gate> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "tasks") || !hasModule(ctx.modules, "tasks")) return { ok: false, error: "forbidden" };
  return { ok: true, ctx };
}

function saved(): TaskBoardResult {
  revalidatePath("/app/tasks");
  return { ok: true };
}

/** Put a card in `columnId`, right above `beforeTaskId` (null = at the end). */
export async function moveTaskOnBoard(
  taskId: string,
  columnId: string,
  beforeTaskId: string | null,
): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    const db = tenantDb(orgId);
    const [task, column] = await Promise.all([
      db.task.findFirst({ where: { id: taskId }, select: { id: true } }),
      db.taskBoardColumn.findFirst({ where: { id: columnId }, select: { id: true, isEntrance: true } }),
    ]);
    if (!task || !column) return { ok: false, error: "not_found" };

    await db.$transaction(
      async (tx) => {
        // The column's OTHER cards in display order; the entrance also holds the
        // cards with no column yet (new tasks).
        const inColumn = column.isEntrance
          ? { OR: [{ boardColumnId: columnId }, { boardColumnId: null }] }
          : { boardColumnId: columnId };
        let cards = (
          await tx.task.findMany({
            where: { organizationId: orgId, id: { not: taskId }, ...inColumn },
            select: { id: true, boardOrder: true, createdAt: true },
          })
        ).sort(compareBoardCards);

        const found = beforeTaskId ? cards.findIndex((c) => c.id === beforeTaskId) : -1;
        const index = found === -1 ? cards.length : found;
        let order = orderForInsert(
          cards.map((c) => c.boardOrder),
          index,
        );
        if (order === null) {
          // Neighbours tied or too close: renumber the column, then insert.
          for (const [i, card] of cards.entries()) {
            await tx.task.updateMany({
              where: { id: card.id, organizationId: orgId },
              data: { boardOrder: (i + 1) * ORDER_STEP },
            });
          }
          cards = cards.map((c, i) => ({ ...c, boardOrder: (i + 1) * ORDER_STEP }));
          order = orderForInsert(
            cards.map((c) => c.boardOrder),
            index,
          ) as number;
        }
        const res = await tx.task.updateMany({
          where: { id: taskId, organizationId: orgId },
          data: { boardColumnId: columnId, boardOrder: order },
        });
        if (res.count !== 1) throw new Error("task not found during move");
      },
      { timeout: 20_000 },
    );
    return saved();
  } catch (error) {
    console.error("Failed to move task on board", error);
    return { ok: false, error: "unknown" };
  }
}

export async function createTaskBoardColumn(rawName: string): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  const name = normalizeColumnName(String(rawName));
  if (!name) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(g.ctx.organizationId);
    const columns = await db.taskBoardColumn.findMany({ select: { order: true } });
    if (columns.length === 0) return { ok: false, error: "invalid" }; // board not built yet
    if (columns.length >= LIMITS.taskBoardColumnsMax) return { ok: false, error: "limit" };
    const order = columns.reduce((max, c) => Math.max(max, c.order), -1) + 1;
    await db.taskBoardColumn.create({ data: { organizationId: g.ctx.organizationId, name, order } });
    return saved();
  } catch (error) {
    console.error("Failed to create task board column", error);
    return { ok: false, error: "unknown" };
  }
}

export async function renameTaskBoardColumn(id: string, rawName: string): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  const name = normalizeColumnName(String(rawName));
  if (!name) return { ok: false, error: "invalid" };
  try {
    const res = await tenantDb(g.ctx.organizationId).taskBoardColumn.updateMany({ where: { id }, data: { name } });
    if (res.count === 0) return { ok: false, error: "not_found" };
    return saved();
  } catch (error) {
    console.error("Failed to rename task board column", error);
    return { ok: false, error: "unknown" };
  }
}

/** Swap a column with its left/right neighbour. */
export async function moveTaskBoardColumn(id: string, direction: "left" | "right"): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (direction !== "left" && direction !== "right") return { ok: false, error: "invalid" };
  const orgId = g.ctx.organizationId;
  try {
    const db = tenantDb(orgId);
    const columns = await db.taskBoardColumn.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const i = columns.findIndex((c) => c.id === id);
    if (i === -1) return { ok: false, error: "not_found" };
    const j = direction === "left" ? i - 1 : i + 1;
    if (j < 0 || j >= columns.length) return saved(); // already at the edge
    [columns[i], columns[j]] = [columns[j], columns[i]];
    await db.$transaction(async (tx) => {
      for (const [order, column] of columns.entries()) {
        await tx.taskBoardColumn.updateMany({ where: { id: column.id, organizationId: orgId }, data: { order } });
      }
    });
    return saved();
  } catch (error) {
    console.error("Failed to move task board column", error);
    return { ok: false, error: "unknown" };
  }
}

/** Make `id` the entrance. Cards sitting in the old entrance with no column
 * stay there: the old entrance id is written on them first. */
export async function setTaskBoardEntrance(id: string): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    const db = tenantDb(orgId);
    const [target, current] = await Promise.all([
      db.taskBoardColumn.findFirst({ where: { id }, select: { id: true } }),
      db.taskBoardColumn.findFirst({ where: { isEntrance: true }, select: { id: true } }),
    ]);
    if (!target) return { ok: false, error: "not_found" };
    if (current?.id === target.id) return saved();
    await db.$transaction(async (tx) => {
      if (current) {
        await tx.task.updateMany({
          where: { organizationId: orgId, boardColumnId: null },
          data: { boardColumnId: current.id },
        });
      }
      await tx.taskBoardColumn.updateMany({ where: { organizationId: orgId, isEntrance: true }, data: { isEntrance: false } });
      await tx.taskBoardColumn.updateMany({ where: { organizationId: orgId, id: target.id }, data: { isEntrance: true } });
    });
    await audit(g.ctx, { action: "task_board.entrance_changed", entity: "TaskBoardColumn", entityId: target.id });
    return saved();
  } catch (error) {
    console.error("Failed to set task board entrance", error);
    return { ok: false, error: "unknown" };
  }
}

/** Delete a column; its cards go back to the entrance (no column). The
 * entrance itself can't be deleted. */
export async function deleteTaskBoardColumn(id: string): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    const db = tenantDb(orgId);
    const column = await db.taskBoardColumn.findFirst({
      where: { id },
      select: { id: true, name: true, isEntrance: true },
    });
    if (!column) return { ok: false, error: "not_found" };
    if (column.isEntrance) return { ok: false, error: "entrance" };
    let cardsMoved = 0;
    await db.$transaction(async (tx) => {
      const res = await tx.task.updateMany({
        where: { organizationId: orgId, boardColumnId: column.id },
        data: { boardColumnId: null },
      });
      cardsMoved = res.count;
      await tx.taskBoardColumn.deleteMany({ where: { organizationId: orgId, id: column.id } });
    });
    await audit(g.ctx, {
      action: "task_board.column_deleted",
      entity: "TaskBoardColumn",
      entityId: column.id,
      meta: { name: column.name, cardsMoved },
    });
    return saved();
  } catch (error) {
    console.error("Failed to delete task board column", error);
    return { ok: false, error: "unknown" };
  }
}
