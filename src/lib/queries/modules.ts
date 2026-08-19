import "server-only";
import { prisma } from "@/lib/prisma";
import { hasFeatureByModules, type Feature, type ModuleId } from "@/config/modules";

/** The org's installed (ACTIVE) module ids — for backend code that has only an
 *  organizationId (no OrgContext), e.g. jobs, cross-module bridges, webhooks. */
export async function orgModuleIds(organizationId: string): Promise<string[]> {
  const rows = await prisma.organizationModule.findMany({
    where: { organizationId, status: "ACTIVE" },
    select: { moduleId: true },
  });
  return rows.map((r) => r.moduleId);
}

/** True when the org has the module installed (ACTIVE). */
export async function orgHasModule(organizationId: string, moduleId: ModuleId): Promise<boolean> {
  const row = await prisma.organizationModule.findFirst({
    where: { organizationId, moduleId, status: "ACTIVE" },
    select: { id: true },
  });
  return row != null;
}

/** True when a feature is unlocked by one of the org's installed modules. */
export async function orgHasFeature(organizationId: string, feature: Feature): Promise<boolean> {
  return hasFeatureByModules(await orgModuleIds(organizationId), feature);
}
