-- AlterTable
ALTER TABLE "task_board_columns" ADD COLUMN     "dateBucket" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "task_board_columns_organizationId_dateBucket_key" ON "task_board_columns"("organizationId", "dateBucket");

-- Backfill: each org's initial date columns ("Atrasadas", "Hoje", "Em breve",
-- "Sem data" in pt; "Overdue", "Today", "Upcoming", "No date" in en) take the
-- new tasks of their bucket. A renamed or deleted one gets none, and its new
-- tasks go to the entrance. The done column never takes a date bucket.
UPDATE "task_board_columns" AS c SET "dateBucket" = d."bucket"
FROM (
  SELECT DISTINCT ON ("organizationId", "bucket") "id", "bucket"
  FROM (
    SELECT "id", "organizationId", "order", "createdAt",
      CASE lower(btrim("name"))
        WHEN 'atrasadas' THEN 'overdue' WHEN 'overdue' THEN 'overdue'
        WHEN 'hoje' THEN 'today' WHEN 'today' THEN 'today'
        WHEN 'em breve' THEN 'upcoming' WHEN 'upcoming' THEN 'upcoming'
        WHEN 'sem data' THEN 'nodate' WHEN 'no date' THEN 'nodate'
      END AS "bucket"
    FROM "task_board_columns"
    WHERE NOT "isDone"
  ) AS named
  WHERE "bucket" IS NOT NULL
  ORDER BY "organizationId", "bucket", "order" ASC, "createdAt" ASC
) AS d
WHERE c."id" = d."id";

-- Until now "no column" meant "the entrance", so every new task fell there.
-- From here on it means "not placed yet". The tasks no one ever placed (in
-- orgs that have a board) go to their date's column as of TODAY in São Paulo
-- (dueDate is stored as UTC), the done ones to the done column, and the
-- entrance when there's no such column.
UPDATE "tasks" AS t SET "boardColumnId" = s."columnId"
FROM (
  SELECT t2."id",
    COALESCE(
      CASE WHEN t2."doneAt" IS NOT NULL THEN dn."id" ELSE db."id" END,
      e."id"
    ) AS "columnId"
  FROM "tasks" AS t2
  JOIN "task_board_columns" AS e ON e."organizationId" = t2."organizationId" AND e."isEntrance"
  LEFT JOIN "task_board_columns" AS dn ON dn."organizationId" = t2."organizationId" AND dn."isDone"
  LEFT JOIN "task_board_columns" AS db ON db."organizationId" = t2."organizationId" AND NOT db."isDone"
    AND db."dateBucket" = CASE
      WHEN t2."dueDate" IS NULL THEN 'nodate'
      WHEN ((t2."dueDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date
           < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'overdue'
      WHEN ((t2."dueDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date
           = (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'today'
      ELSE 'upcoming'
    END
  WHERE t2."boardColumnId" IS NULL
) AS s
WHERE t."id" = s."id";
