-- CreateTable
CREATE TABLE "conversation_folders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_folders_organizationId_order_idx" ON "conversation_folders"("organizationId", "order");

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "customName" TEXT;
ALTER TABLE "conversations" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN "folderId" TEXT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "conversation_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
