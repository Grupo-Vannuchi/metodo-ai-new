-- AlterTable
ALTER TABLE "task_board_columns" ADD COLUMN     "isDone" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: in each org, the column built from the initial "done" bucket
-- ("Concluídas" in pt, "Done" in en) becomes the done column. An org that
-- renamed or deleted it gets none, and completing keeps leaving cards in place.
UPDATE "task_board_columns" AS c SET "isDone" = true
FROM (
  SELECT DISTINCT ON ("organizationId") "id"
  FROM "task_board_columns"
  WHERE NOT "isEntrance" AND lower(btrim("name")) IN ('concluídas', 'concluidas', 'done')
  ORDER BY "organizationId", "order" DESC, "createdAt" ASC
) AS d
WHERE c."id" = d."id";

-- Completed tasks outside the done column go to its top, the most recently
-- completed first, above the cards already there.
UPDATE "tasks" AS t SET "boardColumnId" = s."columnId", "boardOrder" = s."base" - s."rn"
FROM (
  SELECT t2."id", c."id" AS "columnId",
         row_number() OVER (PARTITION BY c."id" ORDER BY t2."doneAt" ASC, t2."id" ASC) AS "rn",
         COALESCE((SELECT MIN(x."boardOrder") FROM "tasks" AS x WHERE x."boardColumnId" = c."id"), 0) AS "base"
  FROM "tasks" AS t2
  JOIN "task_board_columns" AS c ON c."organizationId" = t2."organizationId" AND c."isDone"
  WHERE t2."doneAt" IS NOT NULL AND t2."boardColumnId" IS DISTINCT FROM c."id"
) AS s
WHERE t."id" = s."id";

-- Open tasks inside the done column go to the end of the entrance (no column).
UPDATE "tasks" AS t SET "boardColumnId" = NULL, "boardOrder" = s."base" + s."rn"
FROM (
  SELECT t2."id",
         row_number() OVER (PARTITION BY t2."organizationId" ORDER BY t2."boardOrder" ASC, t2."id" ASC) AS "rn",
         COALESCE((
           SELECT MAX(x."boardOrder") FROM "tasks" AS x
           LEFT JOIN "task_board_columns" AS e ON e."id" = x."boardColumnId"
           WHERE x."organizationId" = t2."organizationId" AND (x."boardColumnId" IS NULL OR e."isEntrance")
         ), 0) AS "base"
  FROM "tasks" AS t2
  JOIN "task_board_columns" AS c ON c."id" = t2."boardColumnId" AND c."isDone"
  WHERE t2."doneAt" IS NULL
) AS s
WHERE t."id" = s."id";
