-- MetodoLoja foundation: per-org installed modules (replaces plan-based feature
-- gating). Uninstall = DORMANT (data kept). See src/config/modules.ts.

CREATE TYPE "ModuleStatus" AS ENUM ('ACTIVE', 'DORMANT');

CREATE TABLE "organization_modules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "status" "ModuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organization_modules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_modules_organizationId_moduleId_key" ON "organization_modules"("organizationId", "moduleId");
CREATE INDEX "organization_modules_organizationId_idx" ON "organization_modules"("organizationId");

ALTER TABLE "organization_modules"
    ADD CONSTRAINT "organization_modules_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill so the plan->module switch is invisible. Everyone had the ungated
-- core screens (crm/tasks/inbox) plus Marketing (STANDARD floor).
INSERT INTO "organization_modules" ("id", "organizationId", "moduleId", "status", "installedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", m."mid", 'ACTIVE', now(), now(), now()
FROM "organizations" o
CROSS JOIN (VALUES ('crm'), ('tasks'), ('inbox'), ('marketing')) AS m("mid");

-- PLUS/GOLD/ENTERPRISE additionally had Financeiro, RH, Suprimentos e IA.
INSERT INTO "organization_modules" ("id", "organizationId", "moduleId", "status", "installedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", m."mid", 'ACTIVE', now(), now(), now()
FROM "organizations" o
CROSS JOIN (VALUES ('finance'), ('hr'), ('supplies'), ('ia')) AS m("mid")
WHERE o."plan" IN ('PLUS', 'GOLD', 'ENTERPRISE');
