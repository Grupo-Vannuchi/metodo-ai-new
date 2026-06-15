-- AlterEnum
ALTER TYPE "ExtractorProvider" ADD VALUE 'GOOGLE';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "extracted_leads" ADD COLUMN     "socials" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "website" TEXT;
