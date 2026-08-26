"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOrgContext, assertRole } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { MODULE_BY_ID, MODULES, MODULE_PRESETS, type ModuleId } from "@/config/modules";

/** Upsert a set of modules to ACTIVE in a company (install/preset/onboarding). */
async function activateModules(db: ReturnType<typeof tenantDb>, organizationId: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    const existing = await db.organizationModule.findFirst({ where: { moduleId: id }, select: { id: true } });
    if (existing) {
      await db.organizationModule.updateMany({ where: { moduleId: id }, data: { status: "ACTIVE", uninstalledAt: null } });
    } else {
      await db.organizationModule.create({ data: { organizationId, moduleId: id, status: "ACTIVE" } });
    }
  }
}

/** Grant account-level entitlements (purchase) for the owner — idempotent. Billed
 *  once per module regardless of how many of the account's companies install it. */
async function buyModules(ownerUserId: string, ids: string[]): Promise<void> {
  for (const moduleId of ids) {
    await prisma.accountModule.upsert({
      where: { ownerUserId_moduleId: { ownerUserId, moduleId } },
      create: { ownerUserId, moduleId },
      update: {},
    });
  }
}

export type ModuleActionResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "has_dependent" | "unknown" };

/** Install a module (+ hard deps) in the CURRENT company. Buys it for the account
 *  first if not owned yet (billed once); an already-owned module installs free.
 *  OWNER/ADMIN only. */
export async function installModule(moduleId: string): Promise<ModuleActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    assertRole(ctx, "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!ctx.accountOwnerId) return { ok: false, error: "unknown" };
  const mod = MODULE_BY_ID[moduleId as ModuleId];
  if (!mod) return { ok: false, error: "invalid" };

  try {
    const ids = [...new Set<string>([mod.id, ...mod.dependsOn])];
    // Account entitlement (purchase, idempotent) + activate in this company.
    await buyModules(ctx.accountOwnerId, ids);
    const db = tenantDb(ctx.organizationId);
    await activateModules(db, ctx.organizationId, ids);
    revalidatePath("/app/loja");
    revalidatePath("/app/settings/billing");
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (error) {
    console.error("Failed to install module", error);
    return { ok: false, error: "unknown" };
  }
}

/** Uninstall a module — DORMANT, so data is kept and a reinstall restores it.
 *  Blocked when another installed module hard-depends on it. OWNER/ADMIN only. */
export async function uninstallModule(moduleId: string): Promise<ModuleActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    assertRole(ctx, "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const mod = MODULE_BY_ID[moduleId as ModuleId];
  if (!mod) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const dependentIds = MODULES.filter((m) => m.dependsOn.includes(mod.id)).map((m) => m.id);
    if (dependentIds.length > 0) {
      const blocking = await db.organizationModule.findFirst({
        where: { moduleId: { in: dependentIds }, status: "ACTIVE" },
        select: { moduleId: true },
      });
      if (blocking) return { ok: false, error: "has_dependent" };
    }
    await db.organizationModule.updateMany({
      where: { moduleId: mod.id },
      data: { status: "DORMANT", uninstalledAt: new Date() },
    });
    revalidatePath("/app/loja");
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (error) {
    console.error("Failed to uninstall module", error);
    return { ok: false, error: "unknown" };
  }
}

/** Install every module in a preset (the old plans, reborn as packages). */
export async function applyPreset(presetId: string): Promise<ModuleActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    assertRole(ctx, "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!ctx.accountOwnerId) return { ok: false, error: "unknown" };
  const preset = MODULE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return { ok: false, error: "invalid" };

  try {
    await buyModules(ctx.accountOwnerId, preset.modules);
    const db = tenantDb(ctx.organizationId);
    await activateModules(db, ctx.organizationId, preset.modules);
    revalidatePath("/app/loja");
    revalidatePath("/app/settings/billing");
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (error) {
    console.error("Failed to apply preset", error);
    return { ok: false, error: "unknown" };
  }
}

/** Finish the "monte seu Método" onboarding: install the chosen modules and mark
 *  the org onboarded so the wizard stops showing. OWNER/ADMIN only. */
export async function completeOnboarding(moduleIds: string[]): Promise<ModuleActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    assertRole(ctx, "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const valid = [...new Set(moduleIds)].filter((id) => MODULE_BY_ID[id as ModuleId]);
  try {
    if (valid.length > 0 && ctx.accountOwnerId) await buyModules(ctx.accountOwnerId, valid);
    const db = tenantDb(ctx.organizationId);
    if (valid.length > 0) await activateModules(db, ctx.organizationId, valid);
    await prisma.organization.update({ where: { id: ctx.organizationId }, data: { onboardedAt: new Date() } });
    revalidatePath("/app/settings/billing");
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (error) {
    console.error("Failed to complete onboarding", error);
    return { ok: false, error: "unknown" };
  }
}

/** Skip onboarding — the org starts "cru" and installs modules later in the Loja. */
export async function skipOnboarding(): Promise<ModuleActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    assertRole(ctx, "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    await prisma.organization.update({ where: { id: ctx.organizationId }, data: { onboardedAt: new Date() } });
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (error) {
    console.error("Failed to skip onboarding", error);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Cancel a module for the whole ACCOUNT (stop billing it). Drops the entitlement
 * and deactivates it in every company of the account (DORMANT — data kept, so a
 * future re-purchase restores it). Account owner only. Blocked while another
 * owned module hard-depends on it.
 */
export async function cancelAccountModule(moduleId: string): Promise<ModuleActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!ctx.isAccountOwner || !ctx.accountOwnerId) return { ok: false, error: "forbidden" };
  const ownerId = ctx.accountOwnerId;
  const mod = MODULE_BY_ID[moduleId as ModuleId];
  if (!mod) return { ok: false, error: "invalid" };

  try {
    const dependentIds = MODULES.filter((m) => m.dependsOn.includes(mod.id)).map((m) => m.id);
    if (dependentIds.length > 0) {
      const stillOwned = await prisma.accountModule.findFirst({
        where: { ownerUserId: ownerId, moduleId: { in: dependentIds } },
        select: { id: true },
      });
      if (stillOwned) return { ok: false, error: "has_dependent" };
    }
    await prisma.$transaction([
      prisma.accountModule.deleteMany({ where: { ownerUserId: ownerId, moduleId: mod.id } }),
      prisma.organizationModule.updateMany({
        where: { moduleId: mod.id, organization: { ownerId } },
        data: { status: "DORMANT", uninstalledAt: new Date() },
      }),
    ]);
    revalidatePath("/app/loja");
    revalidatePath("/app/settings/billing");
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (error) {
    console.error("Failed to cancel account module", error);
    return { ok: false, error: "unknown" };
  }
}
