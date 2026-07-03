-- CreateTable
CREATE TABLE "opportunity_attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunity_attachments_organizationId_opportunityId_idx" ON "opportunity_attachments"("organizationId", "opportunityId");

-- AddForeignKey
ALTER TABLE "opportunity_attachments" ADD CONSTRAINT "opportunity_attachments_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
