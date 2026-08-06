-- Supplies module: client-equipment custody/service tickets.

CREATE TYPE "ServiceTicketStatus" AS ENUM ('RECEIVED', 'IN_SERVICE', 'READY', 'RETURNED', 'CANCELED');

CREATE TABLE "service_tickets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT,
    "assetId" TEXT,
    "companyId" TEXT,
    "equipment" TEXT NOT NULL,
    "status" "ServiceTicketStatus" NOT NULL DEFAULT 'RECEIVED',
    "description" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "expectedReturn" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "responsible" TEXT,
    "cost" DECIMAL(14,2),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_tickets_organizationId_status_idx" ON "service_tickets"("organizationId", "status");
CREATE INDEX "service_tickets_organizationId_companyId_idx" ON "service_tickets"("organizationId", "companyId");
