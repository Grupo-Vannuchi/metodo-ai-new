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

-- Until now "no column" meant "the entrance". From here on it means "not
-- placed yet" (the tasks page places those by date), so the cards already in
-- the entrance with no column get the entrance written on them and stay put.
UPDATE "tasks" AS t SET "boardColumnId" = e."id"
FROM "task_board_columns" AS e
WHERE e."organizationId" = t."organizationId" AND e."isEntrance" AND t."boardColumnId" IS NULL;
