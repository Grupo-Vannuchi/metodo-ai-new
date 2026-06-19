-- AlterEnum
ALTER TYPE "OpportunityStatus" ADD VALUE IF NOT EXISTS 'CANCELED';

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateTable
CREATE TABLE "product_services" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL DEFAULT 'SERVICE',
    "price" DECIMAL(14,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_services_organizationId_active_idx" ON "product_services"("organizationId", "active");

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN "productServiceId" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "code" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "seqYear" INTEGER;
ALTER TABLE "opportunities" ADD COLUMN "seqNumber" INTEGER;
ALTER TABLE "opportunities" ADD COLUMN "expectedCloseDate" TIMESTAMP(3);
ALTER TABLE "opportunities" ADD COLUMN "notes" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "outcomeReason" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "closedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "opportunities_organizationId_seqYear_seqNumber_idx" ON "opportunities"("organizationId", "seqYear", "seqNumber");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_productServiceId_fkey" FOREIGN KEY ("productServiceId") REFERENCES "product_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
