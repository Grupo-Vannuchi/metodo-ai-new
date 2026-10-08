"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { getOrgContext, type OrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { LIMITS } from "@/config/limits";
import { audit } from "@/lib/audit";
import { lockTaskBoard } from "@/lib/tasks/board";
import { compareBoardCards, normalizeColumnName, ORDER_STEP, orderForInsert } from "@/lib/tasks/board-core";

export type TaskBoardError = "unauthorized" | "forbidden" | "invalid" | "not_found" | "limit" | "entrance" | "unknown";
export type TaskBoardResult = { ok: true } | { ok: false; error: TaskBoardError };

type Gate = { ok: true; ctx: OrgContext } | { ok: false; error: TaskBoardError };

/** Thrown inside a transaction to roll it back and return a typed error. */
class BoardError extends Error {
  constructor(readonly code: TaskBoardError) {
    super(code);
  }
}

function fail(error: unknown, label: string): TaskBoardResult {
  if (error instanceof BoardError) return { ok: false, error: error.code };
  console.error(label, error);
  return { ok: false, error: "unknown" };
}

const INVALID: TaskBoardResult = { ok: false, error: "invalid" };

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
  // Server actions are public endpoints: args can be anything.
  if (typeof taskId !== "string" || typeof columnId !== "string") return INVALID;
  if (beforeTaskId !== null && typeof beforeTaskId !== "string") return INVALID;
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    await tenantDb(orgId).$transaction(
      async (tx) => {
        await lockTaskBoard(tx, orgId);
        const [task, column] = await Promise.all([
          tx.task.findFirst({ where: { id: taskId, organizationId: orgId }, select: { id: true } }),
          tx.taskBoardColumn.findFirst({
            where: { id: columnId, organizationId: orgId },
            select: { id: true, isEntrance: true },
          }),
        ]);
        if (!task || !column) throw new BoardError("not_found");

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
          // Neighbours tied or too close: renumber the column in ONE statement
          // (raw SQL is not intercepted by tenantDb: organizationId is explicit).
          const inColumnSql = column.isEntrance
            ? Prisma.sql`("boardColumnId" = ${columnId} OR "boardColumnId" IS NULL)`
            : Prisma.sql`"boardColumnId" = ${columnId}`;
          await tx.$executeRaw`
            UPDATE "tasks" AS t SET "boardOrder" = s.rn * ${ORDER_STEP}
            FROM (
              SELECT "id", row_number() OVER (ORDER BY "boardOrder" ASC, "createdAt" ASC, "id" ASC) AS rn
              FROM "tasks"
              WHERE "organizationId" = ${orgId} AND "id" <> ${taskId} AND ${inColumnSql}
            ) AS s
            WHERE t."id" = s."id" AND t."organizationId" = ${orgId}`;
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
        if (res.count !== 1) throw new BoardError("not_found");
      },
      { timeout: 20_000 },
    );
    return saved();
  } catch (error) {
    return fail(error, "Failed to move task on board");
  }
}

export async function createTaskBoardColumn(rawName: string): Promise<TaskBoardResult> {
  if (typeof rawName !== "string") return INVALID;
  const g = await gate();
  if (!g.ok) return g;
  const name = normalizeColumnName(rawName);
  if (!name) return INVALID;
  const orgId = g.ctx.organizationId;
  try {
    await tenantDb(orgId).$transaction(async (tx) => {
      await lockTaskBoard(tx, orgId);
      const columns = await tx.taskBoardColumn.findMany({ where: { organizationId: orgId }, select: { order: true } });
      if (columns.length === 0) throw new BoardError("invalid"); // board not built yet
      if (columns.length >= LIMITS.taskBoardColumnsMax) throw new BoardError("limit");
      const order = columns.reduce((max, c) => Math.max(max, c.order), -1) + 1;
      await tx.taskBoardColumn.create({ data: { organizationId: orgId, name, order } });
    });
    return saved();
  } catch (error) {
    return fail(error, "Failed to create task board column");
  }
}

export async function renameTaskBoardColumn(id: string, rawName: string): Promise<TaskBoardResult> {
  if (typeof id !== "string" || typeof rawName !== "string") return INVALID;
  const g = await gate();
  if (!g.ok) return g;
  const name = normalizeColumnName(rawName);
  if (!name) return INVALID;
  try {
    const res = await tenantDb(g.ctx.organizationId).taskBoardColumn.updateMany({ where: { id }, data: { name } });
    if (res.count === 0) return { ok: false, error: "not_found" };
    return saved();
  } catch (error) {
    return fail(error, "Failed to rename task board column");
  }
}

/** Swap a column with its left/right neighbour. */
export async function moveTaskBoardColumn(id: string, direction: "left" | "right"): Promise<TaskBoardResult> {
  if (typeof id !== "string" || (direction !== "left" && direction !== "right")) return INVALID;
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    await tenantDb(orgId).$transaction(async (tx) => {
      await lockTaskBoard(tx, orgId);
      const columns = await tx.taskBoardColumn.findMany({
        where: { organizationId: orgId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      const i = columns.findIndex((c) => c.id === id);
      if (i === -1) throw new BoardError("not_found");
      const j = direction === "left" ? i - 1 : i + 1;
      if (j < 0 || j >= columns.length) return; // already at the edge
      [columns[i], columns[j]] = [columns[j], columns[i]];
      for (const [order, column] of columns.entries()) {
        await tx.taskBoardColumn.updateMany({ where: { id: column.id, organizationId: orgId }, data: { order } });
      }
    });
    return saved();
  } catch (error) {
    return fail(error, "Failed to move task board column");
  }
}

/** Make `id` the entrance. Cards sitting in the old entrance with no column
 * stay there: the old entrance id is written on them first. */
export async function setTaskBoardEntrance(id: string): Promise<TaskBoardResult> {
  if (typeof id !== "string") return INVALID;
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    const previous = await tenantDb(orgId).$transaction(async (tx) => {
      await lockTaskBoard(tx, orgId);
      const [target, current] = await Promise.all([
        tx.taskBoardColumn.findFirst({ where: { id, organizationId: orgId }, select: { id: true } }),
        tx.taskBoardColumn.findFirst({ where: { isEntrance: true, organizationId: orgId }, select: { id: true } }),
      ]);
      if (!target) throw new BoardError("not_found");
      if (current?.id === target.id) return null;
      if (current) {
        await tx.task.updateMany({
          where: { organizationId: orgId, boardColumnId: null },
          data: { boardColumnId: current.id },
        });
      }
      await tx.taskBoardColumn.updateMany({ where: { organizationId: orgId, isEntrance: true }, data: { isEntrance: false } });
      const res = await tx.taskBoardColumn.updateMany({
        where: { organizationId: orgId, id: target.id },
        data: { isEntrance: true },
      });
      if (res.count !== 1) throw new BoardError("not_found"); // rolls back: never leave the board without an entrance
      return { from: current?.id ?? null };
    });
    if (previous) {
      await audit(g.ctx, {
        action: "task_board.entrance_changed",
        entity: "TaskBoardColumn",
        entityId: id,
        meta: { from: previous.from },
      });
    }
    return saved();
  } catch (error) {
    return fail(error, "Failed to set task board entrance");
  }
}

/** Delete a column; its cards go back to the entrance (no column). The
 * entrance itself can't be deleted. */
export async function deleteTaskBoardColumn(id: string): Promise<TaskBoardResult> {
  if (typeof id !== "string") return INVALID;
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    const { column, cardsMoved } = await tenantDb(orgId).$transaction(async (tx) => {
      await lockTaskBoard(tx, orgId);
      const column = await tx.taskBoardColumn.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, name: true, isEntrance: true },
      });
      if (!column) throw new BoardError("not_found");
      if (column.isEntrance) throw new BoardError("entrance");
      const entrance = await tx.taskBoardColumn.findFirst({
        where: { isEntrance: true, organizationId: orgId },
        select: { id: true },
      });
      // ONE statement: the cards land at the END of the entrance (no column),
      // numbered after its current max so they never tie with its own cards.
      // Raw SQL is not intercepted by tenantDb: organizationId is explicit.
      const cardsMoved = await tx.$executeRaw`
        UPDATE "tasks" AS t SET "boardColumnId" = NULL, "boardOrder" = base.max_order + s.rn * 0.001
        FROM (
          SELECT "id", row_number() OVER (ORDER BY "boardOrder" ASC, "createdAt" ASC, "id" ASC) AS rn
          FROM "tasks" WHERE "organizationId" = ${orgId} AND "boardColumnId" = ${column.id}
        ) AS s,
        (
          SELECT COALESCE(MAX("boardOrder"), 0) AS max_order FROM "tasks"
          WHERE "organizationId" = ${orgId}
            AND ("boardColumnId" = ${entrance?.id ?? ""} OR "boardColumnId" IS NULL)
        ) AS base
        WHERE t."id" = s."id" AND t."organizationId" = ${orgId}`;
      const res = await tx.taskBoardColumn.deleteMany({ where: { organizationId: orgId, id: column.id, isEntrance: false } });
      if (res.count !== 1) throw new BoardError("not_found");
      return { column, cardsMoved };
    });
    await audit(g.ctx, {
      action: "task_board.column_deleted",
      entity: "TaskBoardColumn",
      entityId: column.id,
      meta: { name: column.name, cardsMoved },
    });
    return saved();
  } catch (error) {
    return fail(error, "Failed to delete task board column");
  }
}
