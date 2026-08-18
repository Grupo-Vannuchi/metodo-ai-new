"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext, assertRole } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { MODULE_BY_ID, MODULES, MODULE_PRESETS, type ModuleId } from "@/config/modules";

export type ModuleActionResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "has_dependent" | "unknown" };

/** Install a module (+ its hard dependencies) for the org. Reactivates a dormant
 *  one (data is kept on uninstall). OWNER/ADMIN only — it changes the bill. */
export async function installModule(moduleId: string): Promise<ModuleActionResult> {
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
    // The module plus any hard dependencies, all set ACTIVE.
    const ids = [...new Set<string>([mod.id, ...mod.dependsOn])];
    for (const id of ids) {
      const existing = await db.organizationModule.findFirst({ where: { moduleId: id }, select: { id: true } });
      if (existing) {
        await db.organizationModule.updateMany({
          where: { moduleId: id },
          data: { status: "ACTIVE", uninstalledAt: null },
        });
      } else {
        await db.organizationModule.create({
          data: { organizationId: ctx.organizationId, moduleId: id, status: "ACTIVE" },
        });
      }
    }
    revalidatePath("/app/loja");
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
  const preset = MODULE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    for (const id of preset.modules) {
      const existing = await db.organizationModule.findFirst({ where: { moduleId: id }, select: { id: true } });
      if (existing) {
        await db.organizationModule.updateMany({
          where: { moduleId: id },
          data: { status: "ACTIVE", uninstalledAt: null },
        });
      } else {
        await db.organizationModule.create({
          data: { organizationId: ctx.organizationId, moduleId: id, status: "ACTIVE" },
        });
      }
    }
    revalidatePath("/app/loja");
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (error) {
    console.error("Failed to apply preset", error);
    return { ok: false, error: "unknown" };
  }
}
