-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CALL', 'MEETING', 'EMAIL', 'WHATSAPP', 'FOLLOWUP', 'OTHER');
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "TaskType" NOT NULL DEFAULT 'OTHER',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueDate" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "createdById" TEXT,
    "contactId" TEXT,
    "companyId" TEXT,
    "opportunityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_organizationId_assignedToId_doneAt_idx" ON "tasks"("organizationId", "assignedToId", "doneAt");
CREATE INDEX "tasks_organizationId_dueDate_idx" ON "tasks"("organizationId", "dueDate");
CREATE INDEX "tasks_organizationId_opportunityId_idx" ON "tasks"("organizationId", "opportunityId");
CREATE INDEX "tasks_organizationId_contactId_idx" ON "tasks"("organizationId", "contactId");
