"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";

export type SavedViewResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

/** Save the board's current filter combination as a named, per-user preset. */
export async function createSavedView(input: {
  name: string;
  query: string;
  scope?: string;
}): Promise<SavedViewResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const name = (input.name ?? "").trim().slice(0, 60);
  const query = (input.query ?? "").trim().slice(0, 500);
  const scope = (input.scope ?? "crm").slice(0, 40);
  if (!name) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const order = await db.savedView.count({ where: { userId: ctx.userId, scope } });
    const view = await db.savedView.create({
      data: { organizationId: ctx.organizationId, userId: ctx.userId, scope, name, query, order },
      select: { id: true },
    });
    revalidatePath("/app/crm");
    return { ok: true, id: view.id };
  } catch (error) {
    console.error("createSavedView failed", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteSavedView(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    // Scope to the owner too — a preset is personal.
    await db.savedView.deleteMany({ where: { id, userId: ctx.userId } });
    revalidatePath("/app/crm");
    return { ok: true };
  } catch (error) {
    console.error("deleteSavedView failed", error);
    return { ok: false };
  }
}
