-- WhatsApp AI auto-responder: per-connection agent config.

CREATE TABLE "whatsapp_agents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
    "handoffMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_agents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_agents_connectionId_key" ON "whatsapp_agents"("connectionId");
CREATE INDEX "whatsapp_agents_organizationId_idx" ON "whatsapp_agents"("organizationId");
