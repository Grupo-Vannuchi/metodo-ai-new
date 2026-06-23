-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "teamFolderId" TEXT,
ADD COLUMN     "teamPinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "team_chat_folders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_chat_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "team_chat_folders_organizationId_order_idx" ON "team_chat_folders"("organizationId", "order");

-- CreateIndex
CREATE INDEX "memberships_teamFolderId_idx" ON "memberships"("teamFolderId");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_teamFolderId_fkey" FOREIGN KEY ("teamFolderId") REFERENCES "team_chat_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_chat_folders" ADD CONSTRAINT "team_chat_folders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

