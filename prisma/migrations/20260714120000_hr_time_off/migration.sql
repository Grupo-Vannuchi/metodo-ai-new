-- CreateEnum
CREATE TYPE "TimeOffType" AS ENUM ('VACATION', 'SICK', 'LEAVE', 'ABSENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "TimeOffStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "time_off" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "TimeOffType" NOT NULL DEFAULT 'VACATION',
    "status" "TimeOffStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "decisionNote" TEXT,
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_off_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_off_organizationId_status_idx" ON "time_off"("organizationId", "status");

-- CreateIndex
CREATE INDEX "time_off_organizationId_employeeId_idx" ON "time_off"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "time_off_organizationId_startDate_idx" ON "time_off"("organizationId", "startDate");

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

