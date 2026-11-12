-- AlterTable
ALTER TABLE "email_broadcasts" ADD COLUMN     "fromEmail" TEXT;

-- CreateTable
CREATE TABLE "email_sender_domains" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_sender_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_sender_domains_domain_key" ON "email_sender_domains"("domain");

-- CreateIndex
CREATE INDEX "email_sender_domains_organizationId_idx" ON "email_sender_domains"("organizationId");

