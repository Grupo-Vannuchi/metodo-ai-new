-- AlterEnum
ALTER TYPE "EmailChannel" ADD VALUE 'GOOGLE';

-- AlterEnum
ALTER TYPE "EmailSenderProvider" ADD VALUE 'GOOGLE';

-- DropIndex
DROP INDEX "email_sender_accounts_organizationId_key";

-- CreateIndex
CREATE UNIQUE INDEX "email_sender_accounts_organizationId_provider_key" ON "email_sender_accounts"("organizationId", "provider");
