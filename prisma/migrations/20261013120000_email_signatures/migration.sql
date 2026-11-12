-- CreateEnum
CREATE TYPE "EmailSignatureKind" AS ENUM ('TEXT', 'IMAGE');

-- AlterTable
ALTER TABLE "email_broadcasts" ADD COLUMN     "signatureHtml" TEXT,
ADD COLUMN     "signatureId" TEXT,
ADD COLUMN     "signatureText" TEXT;

-- CreateTable
CREATE TABLE "email_signatures" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EmailSignatureKind" NOT NULL DEFAULT 'TEXT',
    "html" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "imageAlt" TEXT,
    "imageHref" TEXT,
    "introText" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_signatures_organizationId_idx" ON "email_signatures"("organizationId");

-- AddForeignKey
ALTER TABLE "email_broadcasts" ADD CONSTRAINT "email_broadcasts_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "email_signatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

