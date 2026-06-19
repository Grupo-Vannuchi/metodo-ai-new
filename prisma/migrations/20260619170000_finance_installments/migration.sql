-- AlterTable
ALTER TABLE "finance_entries" ADD COLUMN "installmentGroupId" TEXT;
ALTER TABLE "finance_entries" ADD COLUMN "installmentNo" INTEGER;
ALTER TABLE "finance_entries" ADD COLUMN "installmentTotal" INTEGER;

-- CreateIndex
CREATE INDEX "finance_entries_organizationId_opportunityId_idx" ON "finance_entries"("organizationId", "opportunityId");
CREATE INDEX "finance_entries_organizationId_contactId_idx" ON "finance_entries"("organizationId", "contactId");
