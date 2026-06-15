-- CreateEnum
CREATE TYPE "ExtractorProvider" AS ENUM ('GOOGLE_MAPS', 'GOOGLE_CSE', 'CNPJ', 'INSTAGRAM', 'LINKEDIN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "extraction_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "ExtractorProvider" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "totalFound" INTEGER NOT NULL DEFAULT 0,
    "cursor" JSONB,
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
    "extractionJobId" TEXT NOT NULL,
    "name" TEXT,
    "cnpj" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "importedCompanyId" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extraction_jobs_organizationId_status_idx" ON "extraction_jobs"("organizationId", "status");

-- CreateIndex
CREATE INDEX "extracted_leads_organizationId_extractionJobId_idx" ON "extracted_leads"("organizationId", "extractionJobId");

-- AddForeignKey
ALTER TABLE "extracted_leads" ADD CONSTRAINT "extracted_leads_extractionJobId_fkey" FOREIGN KEY ("extractionJobId") REFERENCES "extraction_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
