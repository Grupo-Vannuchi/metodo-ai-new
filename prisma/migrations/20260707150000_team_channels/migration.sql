-- AlterTable
ALTER TABLE "TeamChat" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "isGroup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT;

