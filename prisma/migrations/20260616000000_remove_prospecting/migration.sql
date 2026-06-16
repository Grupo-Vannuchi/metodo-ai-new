-- Remove prospecting/extraction module.
-- Drops the extraction tables and their enums. The companies.website column
-- (added alongside extraction) is intentionally kept as general CRM data.

-- DropForeignKey / DropTable (extracted_leads references extraction_jobs)
DROP TABLE "extracted_leads";

-- DropTable
DROP TABLE "extraction_jobs";

-- DropEnum
DROP TYPE "ExtractorProvider";

-- DropEnum
DROP TYPE "JobStatus";
