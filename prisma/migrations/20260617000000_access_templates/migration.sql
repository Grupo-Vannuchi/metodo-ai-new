-- Access templates: named screen-access profiles assigned to members.

-- CreateTable
CREATE TABLE "access_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "screens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_templates_organizationId_idx" ON "access_templates"("organizationId");

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN "accessTemplateId" TEXT;

-- CreateIndex
CREATE INDEX "memberships_accessTemplateId_idx" ON "memberships"("accessTemplateId");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_accessTemplateId_fkey" FOREIGN KEY ("accessTemplateId") REFERENCES "access_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
