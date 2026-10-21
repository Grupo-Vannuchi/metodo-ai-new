-- AlterEnum
ALTER TYPE "EmailChannel" ADD VALUE 'SMTP';

-- AlterEnum
ALTER TYPE "EmailSenderProvider" ADD VALUE 'SMTP';

-- AlterTable
ALTER TABLE "email_sender_accounts" ADD COLUMN "dailyLimit" INTEGER,
ADD COLUMN "hourlyLimit" INTEGER;
