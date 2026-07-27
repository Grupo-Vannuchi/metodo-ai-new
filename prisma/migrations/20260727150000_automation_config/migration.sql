-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN "config" JSONB NOT NULL DEFAULT '{}';
