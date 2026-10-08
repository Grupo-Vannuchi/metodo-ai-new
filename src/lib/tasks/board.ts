import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { ENTRANCE_BUCKET, INITIAL_BUCKETS, initialBucket, ORDER_STEP, type BoardBucket } from "@/lib/tasks/board-core";

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
          data: { organizationId, name: names[bucket], order, isEntrance: bucket === ENTRANCE_BUCKET },
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
