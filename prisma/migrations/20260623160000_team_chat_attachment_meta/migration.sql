-- AlterEnum
ALTER TYPE "TeamChatAttachmentType" ADD VALUE 'LEAD';

-- AlterTable
ALTER TABLE "TeamChatMessage" ADD COLUMN     "attachmentHref" TEXT,
ADD COLUMN     "attachmentLabel" TEXT;

