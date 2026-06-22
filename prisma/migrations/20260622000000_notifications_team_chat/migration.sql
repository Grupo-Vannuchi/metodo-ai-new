-- CreateEnum
CREATE TYPE "TeamChatAttachmentType" AS ENUM ('TASK', 'OPP', 'CONTACT', 'COMPANY');

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "createdById" TEXT;

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamChat" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dmKey" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamChatParticipant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamChatParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamChatMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentType" "TeamChatAttachmentType",
    "attachmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_organizationId_userId_readAt_idx" ON "notifications"("organizationId", "userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamChat_dmKey_key" ON "TeamChat"("dmKey");

-- CreateIndex
CREATE INDEX "TeamChat_organizationId_lastMessageAt_idx" ON "TeamChat"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "TeamChatParticipant_organizationId_userId_idx" ON "TeamChatParticipant"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamChatParticipant_chatId_userId_key" ON "TeamChatParticipant"("chatId", "userId");

-- CreateIndex
CREATE INDEX "TeamChatMessage_chatId_createdAt_idx" ON "TeamChatMessage"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChat" ADD CONSTRAINT "TeamChat_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChatParticipant" ADD CONSTRAINT "TeamChatParticipant_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "TeamChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChatParticipant" ADD CONSTRAINT "TeamChatParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChatParticipant" ADD CONSTRAINT "TeamChatParticipant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChatMessage" ADD CONSTRAINT "TeamChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "TeamChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChatMessage" ADD CONSTRAINT "TeamChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChatMessage" ADD CONSTRAINT "TeamChatMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

