-- Supplies module: stock movement ledger (immutable source of truth for balances).

CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT', 'ADJUST', 'TRANSFER_IN', 'TRANSFER_OUT');

CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "type" "StockMovementType" NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "lot" TEXT,
    "validity" TIMESTAMP(3),
    "unitCost" DECIMAL(14,2),
    "reason" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "transferGroupId" TEXT,
    "reversalOfId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_movements_organizationId_itemId_idx" ON "stock_movements"("organizationId", "itemId");
CREATE INDEX "stock_movements_organizationId_warehouseId_idx" ON "stock_movements"("organizationId", "warehouseId");
CREATE INDEX "stock_movements_organizationId_createdAt_idx" ON "stock_movements"("organizationId", "createdAt");
