-- CreateEnum
CREATE TYPE "EmailBroadcastStatus" AS ENUM ('DRAFT', 'SENDING', 'PAUSED', 'DONE');

-- CreateEnum
CREATE TYPE "EmailRecipientStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailSuppressionReason" AS ENUM ('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED');

-- CreateTable
CREATE TABLE "email_broadcasts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "fromName" TEXT,
    "replyTo" TEXT,
    "audience" JSONB NOT NULL DEFAULT '{}',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "status" "EmailBroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "pausedReason" TEXT,
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastDispatchAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_broadcast_recipients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "companyName" TEXT,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactId" TEXT,
    "companyId" TEXT,
    "batchNo" INTEGER NOT NULL,
    "status" "EmailRecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "EmailSuppressionReason" NOT NULL,
    "recipientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_broadcasts_organizationId_createdAt_idx" ON "email_broadcasts"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "email_broadcasts_organizationId_status_idx" ON "email_broadcasts"("organizationId", "status");

-- CreateIndex
CREATE INDEX "email_broadcast_recipients_broadcastId_status_idx" ON "email_broadcast_recipients"("broadcastId", "status");

-- CreateIndex
CREATE INDEX "email_broadcast_recipients_broadcastId_batchNo_idx" ON "email_broadcast_recipients"("broadcastId", "batchNo");

-- CreateIndex
CREATE INDEX "email_broadcast_recipients_organizationId_sentAt_idx" ON "email_broadcast_recipients"("organizationId", "sentAt");

-- CreateIndex
CREATE INDEX "email_broadcast_recipients_providerMessageId_idx" ON "email_broadcast_recipients"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "email_broadcast_recipients_broadcastId_email_key" ON "email_broadcast_recipients"("broadcastId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_organizationId_email_key" ON "email_suppressions"("organizationId", "email");

-- AddForeignKey
ALTER TABLE "email_broadcast_recipients" ADD CONSTRAINT "email_broadcast_recipients_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "email_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

