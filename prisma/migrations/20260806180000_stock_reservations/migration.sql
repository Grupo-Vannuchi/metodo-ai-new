-- Supplies module: stock reservations (soft holds on available stock).

CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "qty" DECIMAL(14,3) NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_reservations_organizationId_itemId_idx" ON "stock_reservations"("organizationId", "itemId");
CREATE INDEX "stock_reservations_organizationId_status_idx" ON "stock_reservations"("organizationId", "status");
