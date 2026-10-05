-- WhatsApp keyword automations: a conversation in the middle of a flow, so the
-- customer's follow-up answers continue it without repeating the keyword.

CREATE TYPE "AutomationSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'HANDOFF', 'CANCELED');

CREATE TABLE "automation_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "AutomationSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "opportunityId" TEXT,
    "lastInboundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "automation_sessions_organizationId_conversationId_status_idx" ON "automation_sessions"("organizationId", "conversationId", "status");
