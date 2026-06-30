-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "isGroup" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "senderName" TEXT;
