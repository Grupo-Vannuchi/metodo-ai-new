-- AlterTable
ALTER TABLE "TeamChatMessage" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "fileMime" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "fileUrl" TEXT,
ADD COLUMN     "mentions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "reactions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "replyToId" TEXT;

-- AddForeignKey
ALTER TABLE "TeamChatMessage" ADD CONSTRAINT "TeamChatMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "TeamChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

