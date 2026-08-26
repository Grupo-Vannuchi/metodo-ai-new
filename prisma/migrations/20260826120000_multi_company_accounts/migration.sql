-- Multi-company per account: Organization.ownerId, account-level module entitlements,
-- and multiple memberships per user.

-- 1. Organization owner (the account).
ALTER TABLE "organizations" ADD COLUMN "ownerId" TEXT;
CREATE INDEX "organizations_ownerId_idx" ON "organizations"("ownerId");

-- Backfill the owner from the existing OWNER membership.
UPDATE "organizations" o
SET "ownerId" = m."userId"
FROM "memberships" m
WHERE m."organizationId" = o."id" AND m."role" = 'OWNER';

-- 2. A user can now belong to several companies: drop the per-user uniqueness.
DROP INDEX IF EXISTS "memberships_userId_key";
CREATE INDEX IF NOT EXISTS "memberships_userId_idx" ON "memberships"("userId");

-- 3. Account-level module entitlements (purchased once, installable in any company).
CREATE TABLE "account_modules" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_modules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "account_modules_ownerUserId_moduleId_key" ON "account_modules"("ownerUserId", "moduleId");
CREATE INDEX "account_modules_ownerUserId_idx" ON "account_modules"("ownerUserId");
ALTER TABLE "account_modules"
  ADD CONSTRAINT "account_modules_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill entitlements: each account owns the modules any of its companies has
-- (regardless of ACTIVE/DORMANT — owning is independent of install status).
INSERT INTO "account_modules" ("id", "ownerUserId", "moduleId", "createdAt")
SELECT gen_random_uuid()::text, o."ownerId", om."moduleId", CURRENT_TIMESTAMP
FROM "organization_modules" om
JOIN "organizations" o ON o."id" = om."organizationId"
WHERE o."ownerId" IS NOT NULL
ON CONFLICT ("ownerUserId", "moduleId") DO NOTHING;
