-- Supplies × Finance bridge: link a purchase order to the expense it generates.

ALTER TABLE "purchase_orders" ADD COLUMN "financeEntryId" TEXT;

ALTER TABLE "finance_entries" ADD COLUMN "purchaseOrderId" TEXT;

CREATE INDEX "finance_entries_organizationId_purchaseOrderId_idx" ON "finance_entries"("organizationId", "purchaseOrderId");
