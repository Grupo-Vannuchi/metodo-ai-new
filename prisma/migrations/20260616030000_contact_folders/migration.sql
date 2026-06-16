-- Contact folders: user-defined groups to organize contacts (drag-and-drop).

-- CreateTable
CREATE TABLE "contact_folders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_folders_organizationId_order_idx" ON "contact_folders"("organizationId", "order");

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "folderId" TEXT;

-- CreateIndex
CREATE INDEX "contacts_organizationId_folderId_idx" ON "contacts"("organizationId", "folderId");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "contact_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
