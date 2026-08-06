"use server";

import { revalidatePath } from "next/cache";
import { type AssetStatus } from "@prisma/client";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb, type TenantDb } from "@/lib/tenant-db";
import { assetSchema, ASSET_STATUSES, type AssetInput } from "@/lib/validations/asset";

export type AssetResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

const s = (v?: string) => (v && v.trim() ? v.trim() : null);

async function validId(
  db: TenantDb,
  model: "supplyItem" | "supplier" | "warehouse" | "company",
  id?: string,
): Promise<string | null> {
  const v = id?.trim();
  if (!v) return null;
  // Each model is org-scoped by the tenant extension via findFirst.
  const row =
    model === "supplyItem"
      ? await db.supplyItem.findFirst({ where: { id: v }, select: { id: true } })
      : model === "supplier"
        ? await db.supplier.findFirst({ where: { id: v }, select: { id: true } })
        : model === "warehouse"
          ? await db.warehouse.findFirst({ where: { id: v }, select: { id: true } })
          : await db.company.findFirst({ where: { id: v }, select: { id: true } });
  return row?.id ?? null;
}

async function toData(db: TenantDb, d: AssetInput) {
  const [itemId, supplierId, warehouseId, ownerCompanyId] = await Promise.all([
    validId(db, "supplyItem", d.itemId),
    validId(db, "supplier", d.supplierId),
    validId(db, "warehouse", d.warehouseId),
    validId(db, "company", d.ownerCompanyId),
  ]);
  return {
    code: s(d.code),
    name: d.name.trim(),
    itemId,
    serialNumber: s(d.serialNumber),
    nature: d.nature,
    status: d.status,
    supplierId,
    warehouseId,
    location: s(d.location),
    custodian: s(d.custodian),
    ownerCompanyId,
    acquisitionDate: d.acquisitionDate ?? null,
    acquisitionValue: d.acquisitionValue ?? null,
    notes: s(d.notes),
    active: d.active,
  };
}

export async function createAsset(input: unknown): Promise<AssetResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = assetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const data = await toData(db, parsed.data);
    const asset = await db.asset.create({
      data: { organizationId: ctx.organizationId, createdById: ctx.userId, ...data },
      select: { id: true },
    });
    revalidatePath("/app/supplies/assets");
    return { ok: true, id: asset.id };
  } catch (e) {
    console.error("createAsset failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function updateAsset(id: string, input: unknown): Promise<AssetResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = assetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const data = await toData(db, parsed.data);
    const res = await db.asset.updateMany({ where: { id }, data });
    if (res.count === 0) return { ok: false, error: "unknown" };
    revalidatePath("/app/supplies/assets");
    revalidatePath(`/app/supplies/assets/${id}/edit`);
    return { ok: true, id };
  } catch (e) {
    console.error("updateAsset failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function setAssetStatus(id: string, status: string): Promise<AssetResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!ASSET_STATUSES.includes(status as (typeof ASSET_STATUSES)[number])) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const res = await db.asset.updateMany({ where: { id }, data: { status: status as AssetStatus } });
    if (res.count === 0) return { ok: false, error: "unknown" };
    revalidatePath("/app/supplies/assets");
    return { ok: true, id };
  } catch (e) {
    console.error("setAssetStatus failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteAsset(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    await tenantDb(ctx.organizationId).asset.deleteMany({ where: { id } });
    revalidatePath("/app/supplies/assets");
    return { ok: true };
  } catch (e) {
    console.error("deleteAsset failed", e);
    return { ok: false };
  }
}
