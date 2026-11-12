-- CreateEnum
CREATE TYPE "EmailChannel" AS ENUM ('PLATFORM', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "EmailSenderProvider" AS ENUM ('MICROSOFT');

-- CreateEnum
CREATE TYPE "EmailSenderAccountStatus" AS ENUM ('ACTIVE', 'NEEDS_RECONNECT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailRecipientStatus" ADD VALUE 'SENDING';
ALTER TYPE "EmailRecipientStatus" ADD VALUE 'UNCERTAIN';

-- AlterTable
ALTER TABLE "email_broadcasts" ADD COLUMN     "channel" "EmailChannel" NOT NULL DEFAULT 'PLATFORM',
ADD COLUMN     "senderAccountId" TEXT;

-- CreateTable
CREATE TABLE "email_sender_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "EmailSenderProvider" NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "accountKind" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "status" "EmailSenderAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_sender_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_sender_accounts_organizationId_key" ON "email_sender_accounts"("organizationId");

-- CreateIndex
CREATE INDEX "email_broadcasts_senderAccountId_idx" ON "email_broadcasts"("senderAccountId");

-- AddForeignKey
ALTER TABLE "email_broadcasts" ADD CONSTRAINT "email_broadcasts_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "email_sender_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

