-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "reactions" JSONB NOT NULL DEFAULT '[]';

