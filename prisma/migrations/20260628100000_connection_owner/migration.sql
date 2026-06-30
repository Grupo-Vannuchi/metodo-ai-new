-- AlterTable
ALTER TABLE "integration_connections" ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "integration_connections_organizationId_ownerId_idx" ON "integration_connections"("organizationId", "ownerId");

-- Backfill: existing WhatsApp connections become owned by the org's OWNER user
-- (they were org-shared before per-user ownership was introduced).
UPDATE "integration_connections" ic
SET "ownerId" = (
  SELECT m."userId" FROM "memberships" m
  WHERE m."organizationId" = ic."organizationId" AND m.role = 'OWNER'
  ORDER BY m."createdAt" ASC
  LIMIT 1
)
WHERE ic.provider IN ('EVOLUTION', 'META_CLOUD') AND ic."ownerId" IS NULL;
