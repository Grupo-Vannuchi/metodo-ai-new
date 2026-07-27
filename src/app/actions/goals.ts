"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext, hasRole } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";

export type GoalResult = { ok: true } | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "unknown" };

/** Set (or clear, with 0) a member's monthly target. Admins/owners only. */
export async function setGoal(input: {
  userId: string;
  month: string;
  targetValue: number;
}): Promise<GoalResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!hasRole(ctx.role, "ADMIN")) return { ok: false, error: "forbidden" };

  const userId = (input.userId ?? "").trim();
  const month = (input.month ?? "").trim();
  const target = Number(input.targetValue);
  if (!userId || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(target) || target < 0) {
    return { ok: false, error: "invalid" };
  }

  try {
    const db = tenantDb(ctx.organizationId);
    // upsert isn't auto-scoped by tenantDb, so organizationId is passed explicitly.
    await db.goal.upsert({
      where: { organizationId_userId_month: { organizationId: ctx.organizationId, userId, month } },
      create: { organizationId: ctx.organizationId, userId, month, targetValue: target },
      update: { targetValue: target },
    });
    revalidatePath("/app/hr/goals");
    return { ok: true };
  } catch (error) {
    console.error("setGoal failed", error);
    return { ok: false, error: "unknown" };
  }
}
