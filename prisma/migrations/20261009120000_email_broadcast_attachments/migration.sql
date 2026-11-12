-- AlterTable
ALTER TABLE "email_broadcasts" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]';

