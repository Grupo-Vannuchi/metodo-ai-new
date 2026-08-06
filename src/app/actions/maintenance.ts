"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb, type TenantDb } from "@/lib/tenant-db";
import {
  scheduleMaintenanceSchema,
  completeMaintenanceSchema,
} from "@/lib/validations/maintenance";

export type MaintenanceResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" | "state" };

const s = (v?: string) => (v && v.trim() ? v.trim() : null);

function addMonths(d: Date, m: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + m);
  return r;
}

async function validAsset(db: TenantDb, id: string): Promise<string | null> {
  const a = await db.asset.findFirst({ where: { id }, select: { id: true } });
  return a?.id ?? null;
}

export async function scheduleMaintenance(input: unknown): Promise<MaintenanceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = scheduleMaintenanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;
  try {
    const db = tenantDb(ctx.organizationId);
    const assetId = await validAsset(db, d.assetId);
    if (!assetId) return { ok: false, error: "invalid" };
    const ev = await db.maintenanceEvent.create({
      data: {
        organizationId: ctx.organizationId,
        assetId,
        type: d.type,
        status: "SCHEDULED",
        dueDate: d.dueDate,
        provider: s(d.provider),
        notes: s(d.notes),
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    revalidatePath("/app/supplies/maintenance");
    return { ok: true, id: ev.id };
  } catch (e) {
    console.error("scheduleMaintenance failed", e);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Complete an event. When the asset's linked catalog item defines a periodicity
 * for this event type (calibration/maintenance months), the next due date is
 * computed from the performed date and, if requested, a new SCHEDULED event is
 * created — keeping recurring calibrations/maintenance on the agenda.
 */
export async function completeMaintenance(id: string, input: unknown): Promise<MaintenanceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = completeMaintenanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;
  try {
    const db = tenantDb(ctx.organizationId);
    const ev = await db.maintenanceEvent.findFirst({ where: { id } });
    if (!ev) return { ok: false, error: "unknown" };
    if (ev.status !== "SCHEDULED") return { ok: false, error: "state" };

    const performedAt = d.performedAt ?? new Date();

    // Look up the periodicity from the asset's linked item, if any.
    let period: number | null = null;
    const asset = await db.asset.findFirst({ where: { id: ev.assetId }, select: { itemId: true } });
    if (asset?.itemId) {
      const item = await db.supplyItem.findFirst({
        where: { id: asset.itemId },
        select: { calibrationPeriodMonths: true, maintenancePeriodMonths: true },
      });
      period = ev.type === "CALIBRATION" ? item?.calibrationPeriodMonths ?? null : item?.maintenancePeriodMonths ?? null;
    }
    const nextDueDate = period && period > 0 ? addMonths(performedAt, period) : null;

    await db.maintenanceEvent.updateMany({
      where: { id },
      data: {
        status: "DONE",
        performedAt,
        provider: s(d.provider) ?? ev.provider,
        cost: d.cost ?? null,
        certificate: s(d.certificate),
        result: s(d.result),
        notes: s(d.notes) ?? ev.notes,
        nextDueDate,
      },
    });

    // Auto-schedule the next occurrence.
    if (d.autoNext && nextDueDate) {
      await db.maintenanceEvent.create({
        data: {
          organizationId: ctx.organizationId,
          assetId: ev.assetId,
          type: ev.type,
          status: "SCHEDULED",
          dueDate: nextDueDate,
          provider: s(d.provider) ?? ev.provider,
          createdById: ctx.userId,
        },
      });
    }

    revalidatePath("/app/supplies/maintenance");
    return { ok: true, id };
  } catch (e) {
    console.error("completeMaintenance failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function cancelMaintenance(id: string): Promise<MaintenanceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const db = tenantDb(ctx.organizationId);
    const ev = await db.maintenanceEvent.findFirst({ where: { id }, select: { status: true } });
    if (!ev) return { ok: false, error: "unknown" };
    if (ev.status !== "SCHEDULED") return { ok: false, error: "state" };
    await db.maintenanceEvent.updateMany({ where: { id }, data: { status: "CANCELED" } });
    revalidatePath("/app/supplies/maintenance");
    return { ok: true, id };
  } catch (e) {
    console.error("cancelMaintenance failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteMaintenance(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    await tenantDb(ctx.organizationId).maintenanceEvent.deleteMany({ where: { id } });
    revalidatePath("/app/supplies/maintenance");
    return { ok: true };
  } catch (e) {
    console.error("deleteMaintenance failed", e);
    return { ok: false };
  }
}
