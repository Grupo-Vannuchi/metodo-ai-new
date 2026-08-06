-- Supplies module: individual assets (patrimônio).

CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED');

CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "itemId" TEXT,
    "serialNumber" TEXT,
    "nature" "PropertyNature" NOT NULL DEFAULT 'OWN',
    "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "supplierId" TEXT,
    "warehouseId" TEXT,
    "location" TEXT,
    "custodian" TEXT,
    "ownerCompanyId" TEXT,
    "acquisitionDate" TIMESTAMP(3),
    "acquisitionValue" DECIMAL(14,2),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assets_organizationId_status_idx" ON "assets"("organizationId", "status");
CREATE INDEX "assets_organizationId_code_idx" ON "assets"("organizationId", "code");
