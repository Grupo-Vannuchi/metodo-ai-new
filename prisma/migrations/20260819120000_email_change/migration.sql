-- Add the pending e-mail column (double opt-in email change) and the EMAIL_CHANGE token purpose.
ALTER TABLE "users" ADD COLUMN "pendingEmail" TEXT;
ALTER TYPE "AuthTokenPurpose" ADD VALUE IF NOT EXISTS 'EMAIL_CHANGE';
