-- Prospecting: Google Places discovery + website enrichment.

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "extraction_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "query" JSONB NOT NULL DEFAULT '{}',
    "status" "ExtractionStatus" NOT NULL DEFAULT 'QUEUED',
    "target" INTEGER,
    "total" INTEGER NOT NULL DEFAULT 0,
    "pageToken" TEXT,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extraction_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_leads" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "placeId" TEXT,
    "name" TEXT,
    "segment" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "linkedin" TEXT,
    "rating" DOUBLE PRECISION,
    "importedCompanyId" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extraction_jobs_organizationId_status_idx" ON "extraction_jobs"("organizationId", "status");

-- CreateIndex
CREATE INDEX "extraction_jobs_status_createdAt_idx" ON "extraction_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "extracted_leads_organizationId_jobId_idx" ON "extracted_leads"("organizationId", "jobId");

-- AddForeignKey
ALTER TABLE "extracted_leads" ADD CONSTRAINT "extracted_leads_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "extraction_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
