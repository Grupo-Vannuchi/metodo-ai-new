-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "folderId" TEXT;

-- CreateTable
CREATE TABLE "company_folders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_folders_organizationId_order_idx" ON "company_folders"("organizationId", "order");

-- CreateIndex
CREATE INDEX "companies_organizationId_folderId_idx" ON "companies"("organizationId", "folderId");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "company_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

