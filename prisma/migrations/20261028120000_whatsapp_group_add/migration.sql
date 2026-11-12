-- CreateEnum
CREATE TYPE "WhatsappGroupAddStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "WhatsappGroupAddItemStatus" AS ENUM ('PENDING', 'PROCESSING', 'ADDED', 'INVITED', 'ALREADY_IN', 'NO_WHATSAPP', 'SKIPPED', 'LEFT_GROUP', 'ALREADY_INVITED', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp_group_add_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "senderKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "inviteText" TEXT NOT NULL,
    "inviteUrl" TEXT,
    "status" "WhatsappGroupAddStatus" NOT NULL DEFAULT 'QUEUED',
    "pausedReason" TEXT,
    "waitReason" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastDispatchAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_group_add_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_group_add_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "phone" TEXT,
    "phoneKey" TEXT,
    "senderKey" TEXT NOT NULL,
    "status" "WhatsappGroupAddItemStatus" NOT NULL DEFAULT 'PENDING',
    "code" TEXT,
    "reason" TEXT,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_group_add_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_group_add_runs_organizationId_createdAt_idx" ON "whatsapp_group_add_runs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_group_add_runs_organizationId_status_idx" ON "whatsapp_group_add_runs"("organizationId", "status");

-- CreateIndex
CREATE INDEX "whatsapp_group_add_runs_organizationId_groupJid_idx" ON "whatsapp_group_add_runs"("organizationId", "groupJid");

-- CreateIndex
CREATE INDEX "whatsapp_group_add_runs_senderKey_status_idx" ON "whatsapp_group_add_runs"("senderKey", "status");

-- CreateIndex
CREATE INDEX "whatsapp_group_add_items_runId_status_position_idx" ON "whatsapp_group_add_items"("runId", "status", "position");

-- CreateIndex
CREATE INDEX "whatsapp_group_add_items_organizationId_contactId_idx" ON "whatsapp_group_add_items"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "whatsapp_group_add_items_senderKey_processedAt_idx" ON "whatsapp_group_add_items"("senderKey", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_group_add_items_runId_contactId_key" ON "whatsapp_group_add_items"("runId", "contactId");

-- AddForeignKey
ALTER TABLE "whatsapp_group_add_items" ADD CONSTRAINT "whatsapp_group_add_items_runId_fkey" FOREIGN KEY ("runId") REFERENCES "whatsapp_group_add_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

