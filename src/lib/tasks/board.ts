import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import {
  columnForDoneChange,
  columnForNewTask,
  compareBoardCards,
  ENTRANCE_BUCKET,
  INITIAL_BUCKETS,
  initialBucket,
  ORDER_STEP,
  orderForInsert,
  type BoardBucket,
} from "@/lib/tasks/board-core";

/** The fields of a column the pure board rules need (BoardColumn). */
const COLUMN_SELECT = { id: true, name: true, order: true, isEntrance: true, isDone: true, dateBucket: true } as const;

/**
 * Serializes every board mutation of an org: a per-org advisory lock held until
 * the surrounding transaction commits or rolls back. Call it first inside the
 * transaction, then read the state you decide on.
 */
export async function lockTaskBoard(tx: Pick<Prisma.TransactionClient, "$queryRaw">, organizationId: string): Promise<void> {
  // `SELECT 1 FROM` avoids returning a void column.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`task_board:${organizationId}`}))`;
}

/**
 * Builds the org's task board on its first open: the 5 initial columns, every
 * existing task placed where the old automatic board showed it (São Paulo
 * time), and each column numbered by due date. Idempotent and race-safe: a
 * per-org transaction lock + re-count means two simultaneous first opens
 * create ONE board. Called by the kanban page before it lists anything.
 */
export async function ensureTaskBoard(organizationId: string, names: Record<BoardBucket, string>): Promise<void> {
  const db = tenantDb(organizationId);
  if ((await db.taskBoardColumn.count()) > 0) return;

  await db.$transaction(
    async (tx) => {
      await lockTaskBoard(tx, organizationId);
      if ((await tx.taskBoardColumn.count({ where: { organizationId } })) > 0) return;

      const idByBucket = {} as Record<BoardBucket, string>;
      for (const [order, bucket] of INITIAL_BUCKETS.entries()) {
        const column = await tx.taskBoardColumn.create({
          data: {
            organizationId,
            name: names[bucket],
            order,
            isEntrance: bucket === ENTRANCE_BUCKET,
            isDone: bucket === "done",
            dateBucket: bucket === "done" ? null : bucket,
          },
          select: { id: true },
        });
        idByBucket[bucket] = column.id;
      }

      const now = new Date();
      const tasks = await tx.task.findMany({
        where: { organizationId },
        select: { id: true, doneAt: true, dueDate: true },
      });
      const idsByBucket = new Map<BoardBucket, string[]>();
      for (const task of tasks) {
        const bucket = initialBucket(task, now);
        if (bucket === ENTRANCE_BUCKET) continue; // no column = the entrance
        const ids = idsByBucket.get(bucket);
        if (ids) ids.push(task.id);
        else idsByBucket.set(bucket, [task.id]);
      }
      for (const [bucket, ids] of idsByBucket) {
        await tx.task.updateMany({
          where: { organizationId, id: { in: ids } },
          data: { boardColumnId: idByBucket[bucket] },
        });
      }

      // Number each column by due date (no date last), then creation. Raw SQL
      // is not intercepted by tenantDb: organizationId is filtered explicitly.
      await tx.$executeRaw`
        UPDATE "tasks" AS t SET "boardOrder" = s.rn * ${ORDER_STEP}
        FROM (
          SELECT "id", row_number() OVER (
            PARTITION BY "boardColumnId" ORDER BY "dueDate" ASC NULLS LAST, "createdAt" ASC, "id" ASC
          ) AS rn
          FROM "tasks" WHERE "organizationId" = ${organizationId}
        ) AS s
        WHERE t."id" = s."id" AND t."organizationId" = ${organizationId}`;
    },
    { timeout: 20_000 },
  );
}

/**
 * Puts a task's card where its done state says (columnForDoneChange): a
 * completed task at the top of the done column, a reopened one that sat there
 * at the end of its date's column (the entrance when there's none). Reads the
 * state under the board lock, so two quick toggles end in the right column.
 * No-op without a board or a done column. Call it after every write that may
 * complete or reopen a task.
 */
export async function placeTaskByDoneState(organizationId: string, taskId: string): Promise<void> {
  await tenantDb(organizationId).$transaction(
    async (tx) => {
      await lockTaskBoard(tx, organizationId);
      const [task, columns] = await Promise.all([
        tx.task.findFirst({
          where: { id: taskId, organizationId },
          select: { boardColumnId: true, doneAt: true, dueDate: true },
        }),
        tx.taskBoardColumn.findMany({ where: { organizationId }, select: COLUMN_SELECT }),
      ]);
      if (!task) return;
      const target = columnForDoneChange(task.doneAt != null, task, columns, new Date());
      const column = target ? columns.find((c) => c.id === target.columnId) : undefined;
      if (!target || !column) return;

      // The column's OTHER cards in display order; the entrance also holds the
      // cards with no column yet.
      const inColumn = column.isEntrance
        ? { OR: [{ boardColumnId: column.id }, { boardColumnId: null }] }
        : { boardColumnId: column.id };
      const orders = (
        await tx.task.findMany({
          where: { organizationId, id: { not: taskId }, ...inColumn },
          select: { id: true, boardOrder: true, createdAt: true },
        })
      )
        .sort(compareBoardCards)
        .map((c) => c.boardOrder);
      // At an end there's at most one neighbour, so orderForInsert never returns null.
      const order = orderForInsert(orders, target.at === "start" ? 0 : orders.length) ?? 0;
      await tx.task.updateMany({
        where: { id: taskId, organizationId },
        data: { boardColumnId: column.id, boardOrder: order },
      });
    },
    { timeout: 20_000 },
  );
}

/**
 * Places the tasks no one has placed yet — no column: just created by any path
 * (form, recurrence, assistant, automations, WhatsApp) — in the column for their
 * due date as of the day they were created, or the done column when done
 * (columnForNewTask); the entrance when there's no such column. Their
 * boardOrder (creation instant) keeps them at the end. The tasks page calls it
 * right after ensureTaskBoard, before listing, so no creation path needs to
 * know the board.
 */
export async function placeNewTasks(organizationId: string): Promise<void> {
  const db = tenantDb(organizationId);
  if ((await db.task.count({ where: { boardColumnId: null } })) === 0) return;

  await db.$transaction(
    async (tx) => {
      await lockTaskBoard(tx, organizationId);
      const [tasks, columns] = await Promise.all([
        tx.task.findMany({
          where: { organizationId, boardColumnId: null },
          select: { id: true, doneAt: true, dueDate: true, createdAt: true },
        }),
        tx.taskBoardColumn.findMany({ where: { organizationId }, select: COLUMN_SELECT }),
      ]);
      const entrance = columns.find((c) => c.isEntrance) ?? columns[0];
      if (!entrance) return; // no board yet: ensureTaskBoard places everything when it builds one

      const idsByColumn = new Map<string, string[]>();
      for (const task of tasks) {
        const columnId = columnForNewTask(task, columns) ?? entrance.id;
        const ids = idsByColumn.get(columnId);
        if (ids) ids.push(task.id);
        else idsByColumn.set(columnId, [task.id]);
      }
      for (const [columnId, ids] of idsByColumn) {
        await tx.task.updateMany({
          where: { organizationId, id: { in: ids }, boardColumnId: null },
          data: { boardColumnId: columnId },
        });
      }
    },
    { timeout: 20_000 },
  );
}
