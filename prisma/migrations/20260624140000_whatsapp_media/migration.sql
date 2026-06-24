-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "mediaDurationSec" INTEGER,
ADD COLUMN     "mediaHeight" INTEGER,
ADD COLUMN     "mediaName" TEXT,
ADD COLUMN     "mediaSize" INTEGER,
ADD COLUMN     "mediaStatus" "MediaStatus",
ADD COLUMN     "mediaWidth" INTEGER;
