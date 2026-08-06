-- Supplies module: maintenance & calibration events for assets.

CREATE TYPE "MaintenanceType" AS ENUM ('MAINTENANCE', 'CALIBRATION');
CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'DONE', 'CANCELED');

CREATE TABLE "maintenance_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "performedAt" TIMESTAMP(3),
    "provider" TEXT,
    "cost" DECIMAL(14,2),
    "certificate" TEXT,
    "result" TEXT,
    "nextDueDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "maintenance_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "maintenance_events_organizationId_assetId_idx" ON "maintenance_events"("organizationId", "assetId");
CREATE INDEX "maintenance_events_organizationId_status_dueDate_idx" ON "maintenance_events"("organizationId", "status", "dueDate");

ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
