-- CreateEnum
CREATE TYPE "FinanceType" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "FinanceStatus" AS ENUM ('PENDING', 'SETTLED');
CREATE TYPE "FinanceMethod" AS ENUM ('PIX', 'BOLETO', 'CARD', 'CASH', 'TRANSFER', 'OTHER');

-- CreateTable
CREATE TABLE "finance_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinanceType" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "FinanceType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "FinanceStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "method" "FinanceMethod",
    "notes" TEXT,
    "categoryId" TEXT,
    "contactId" TEXT,
    "companyId" TEXT,
    "opportunityId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_categories_organizationId_type_name_key" ON "finance_categories"("organizationId", "type", "name");
CREATE INDEX "finance_categories_organizationId_type_idx" ON "finance_categories"("organizationId", "type");
CREATE INDEX "finance_entries_organizationId_dueDate_idx" ON "finance_entries"("organizationId", "dueDate");
CREATE INDEX "finance_entries_organizationId_type_status_idx" ON "finance_entries"("organizationId", "type", "status");
CREATE INDEX "finance_entries_organizationId_settledAt_idx" ON "finance_entries"("organizationId", "settledAt");

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
