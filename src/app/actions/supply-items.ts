"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { supplyItemSchema, type SupplyItemInput } from "@/lib/validations/supply-item";

export type SupplyItemResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

function toData(d: SupplyItemInput) {
  const s = (v?: string) => (v && v.trim() ? v.trim() : null);
  const n = (v?: number) => (v == null ? null : v);
  return {
    code: s(d.code),
    description: d.description.trim(),
    shortName: s(d.shortName),
    unit: s(d.unit),
    category: s(d.category),
    brand: s(d.brand),
    model: s(d.model),
    barcode: s(d.barcode),
    ncm: s(d.ncm),
    manufacturerCode: s(d.manufacturerCode),
    type: d.type,
    nature: d.nature,
    controlsStock: d.controlsStock,
    controlsLot: d.controlsLot,
    controlsValidity: d.controlsValidity,
    individualControl: d.individualControl,
    canSell: d.canSell,
    canRent: d.canRent,
    canReserve: d.canReserve,
    requiresCalibration: d.requiresCalibration,
    requiresMaintenance: d.requiresMaintenance,
    critical: d.critical,
    leadTimeDays: n(d.leadTimeDays),
    minStock: n(d.minStock),
    maxStock: n(d.maxStock),
    reorderPoint: n(d.reorderPoint),
    lastCost: n(d.lastCost),
    avgCost: n(d.avgCost),
    salePrice: n(d.salePrice),
    rentPrice: n(d.rentPrice),
    costCenter: s(d.costCenter),
    defaultWarehouse: s(d.defaultWarehouse),
    location: s(d.location),
    shelf: s(d.shelf),
    weight: n(d.weight),
    dimensions: s(d.dimensions),
    hazardous: d.hazardous,
    logisticsNotes: s(d.logisticsNotes),
    calibrationPeriodMonths: n(d.calibrationPeriodMonths),
    maintenancePeriodMonths: n(d.maintenancePeriodMonths),
    warningDays: n(d.warningDays),
    measurementRange: s(d.measurementRange),
    resolution: s(d.resolution),
    notes: s(d.notes),
    active: d.active,
  };
}

/** Resolve a supplier id that actually belongs to the org (else drop it). */
async function resolveSupplierId(organizationId: string, supplierId?: string): Promise<string | null> {
  const id = supplierId?.trim();
  if (!id) return null;
  const s = await tenantDb(organizationId).supplier.findFirst({ where: { id }, select: { id: true } });
  return s?.id ?? null;
}

export async function createSupplyItem(input: unknown): Promise<SupplyItemResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = supplyItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const supplierId = await resolveSupplierId(ctx.organizationId, parsed.data.supplierId);
    const item = await db.supplyItem.create({
      data: { organizationId: ctx.organizationId, supplierId, ...toData(parsed.data) },
      select: { id: true },
    });
    revalidatePath("/app/supplies/items");
    return { ok: true, id: item.id };
  } catch (e) {
    console.error("createSupplyItem failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function updateSupplyItem(id: string, input: unknown): Promise<SupplyItemResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = supplyItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const supplierId = await resolveSupplierId(ctx.organizationId, parsed.data.supplierId);
    const res = await db.supplyItem.updateMany({ where: { id }, data: { supplierId, ...toData(parsed.data) } });
    if (res.count === 0) return { ok: false, error: "unknown" };
    revalidatePath("/app/supplies/items");
    revalidatePath(`/app/supplies/items/${id}`);
    return { ok: true, id };
  } catch (e) {
    console.error("updateSupplyItem failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteSupplyItem(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    await tenantDb(ctx.organizationId).supplyItem.deleteMany({ where: { id } });
    revalidatePath("/app/supplies/items");
    return { ok: true };
  } catch (e) {
    console.error("deleteSupplyItem failed", e);
    return { ok: false };
  }
}
