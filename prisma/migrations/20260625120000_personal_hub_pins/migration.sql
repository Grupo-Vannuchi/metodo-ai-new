-- CreateEnum
CREATE TYPE "PinnedEntity" AS ENUM ('TASK', 'OPP', 'CONTACT', 'COMPANY');

-- CreateTable
CREATE TABLE "pinned_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" "PinnedEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pinned_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pinned_items_organizationId_userId_idx" ON "pinned_items"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "pinned_items_userId_entityType_entityId_key" ON "pinned_items"("userId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "pinned_items" ADD CONSTRAINT "pinned_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
