-- Supplies module: single item registry (cadastro único).

CREATE TYPE "SupplyItemType" AS ENUM ('MATERIAL', 'INSUMO', 'PATRIMONIO', 'CLIENT_EQUIPMENT', 'SERVICE', 'KIT');
CREATE TYPE "PropertyNature" AS ENUM ('OWN', 'CLIENT', 'THIRD_PARTY', 'RESALE');

CREATE TABLE "supply_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "shortName" TEXT,
    "unit" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "barcode" TEXT,
    "ncm" TEXT,
    "manufacturerCode" TEXT,
    "type" "SupplyItemType" NOT NULL DEFAULT 'MATERIAL',
    "nature" "PropertyNature" NOT NULL DEFAULT 'OWN',
    "controlsStock" BOOLEAN NOT NULL DEFAULT true,
    "controlsLot" BOOLEAN NOT NULL DEFAULT false,
    "controlsValidity" BOOLEAN NOT NULL DEFAULT false,
    "individualControl" BOOLEAN NOT NULL DEFAULT false,
    "canSell" BOOLEAN NOT NULL DEFAULT false,
    "canRent" BOOLEAN NOT NULL DEFAULT false,
    "canReserve" BOOLEAN NOT NULL DEFAULT true,
    "requiresCalibration" BOOLEAN NOT NULL DEFAULT false,
    "requiresMaintenance" BOOLEAN NOT NULL DEFAULT false,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "supplierId" TEXT,
    "leadTimeDays" INTEGER,
    "minStock" DECIMAL(14,3),
    "maxStock" DECIMAL(14,3),
    "reorderPoint" DECIMAL(14,3),
    "lastCost" DECIMAL(14,2),
    "avgCost" DECIMAL(14,2),
    "salePrice" DECIMAL(14,2),
    "rentPrice" DECIMAL(14,2),
    "costCenter" TEXT,
    "defaultWarehouse" TEXT,
    "location" TEXT,
    "shelf" TEXT,
    "weight" DECIMAL(12,3),
    "dimensions" TEXT,
    "hazardous" BOOLEAN NOT NULL DEFAULT false,
    "logisticsNotes" TEXT,
    "calibrationPeriodMonths" INTEGER,
    "maintenancePeriodMonths" INTEGER,
    "warningDays" INTEGER,
    "measurementRange" TEXT,
    "resolution" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "supply_items_organizationId_type_idx" ON "supply_items"("organizationId", "type");
CREATE INDEX "supply_items_organizationId_description_idx" ON "supply_items"("organizationId", "description");
