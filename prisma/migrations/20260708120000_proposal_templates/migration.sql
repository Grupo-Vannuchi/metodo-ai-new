-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "document" JSONB;

-- CreateTable
CREATE TABLE "proposal_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "validityDays" INTEGER,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_template_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "productServiceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(14,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposal_templates_organizationId_name_idx" ON "proposal_templates"("organizationId", "name");

-- CreateIndex
CREATE INDEX "proposal_template_items_organizationId_templateId_idx" ON "proposal_template_items"("organizationId", "templateId");

-- AddForeignKey
ALTER TABLE "proposal_template_items" ADD CONSTRAINT "proposal_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "proposal_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_template_items" ADD CONSTRAINT "proposal_template_items_productServiceId_fkey" FOREIGN KEY ("productServiceId") REFERENCES "product_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
