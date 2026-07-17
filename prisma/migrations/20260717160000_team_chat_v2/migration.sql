-- AlterTable
ALTER TABLE "TeamChatMessage" ADD COLUMN     "pinnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "typingAt" TIMESTAMP(3),
ADD COLUMN     "typingChatId" TEXT;

-- CreateIndex
CREATE INDEX "TeamChatMessage_chatId_pinnedAt_idx" ON "TeamChatMessage"("chatId", "pinnedAt");

