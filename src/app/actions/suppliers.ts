"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { supplierSchema, type SupplierInput } from "@/lib/validations/supplier";

export type SupplierResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

function toData(d: SupplierInput) {
  return {
    name: d.name.trim(),
    tradeName: d.tradeName?.trim() || null,
    document: d.document?.trim() || null,
    email: d.email?.trim() || null,
    phone: d.phone?.trim() || null,
    contactName: d.contactName?.trim() || null,
    city: d.city?.trim() || null,
    uf: d.uf?.trim().toUpperCase() || null,
    notes: d.notes?.trim() || null,
    active: d.active ?? true,
  };
}

export async function createSupplier(input: SupplierInput): Promise<SupplierResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const s = await db.supplier.create({
      data: { organizationId: ctx.organizationId, ...toData(parsed.data) },
      select: { id: true },
    });
    revalidatePath("/app/supplies/suppliers");
    return { ok: true, id: s.id };
  } catch (e) {
    console.error("createSupplier failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function updateSupplier(id: string, input: SupplierInput): Promise<SupplierResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const res = await db.supplier.updateMany({ where: { id }, data: toData(parsed.data) });
    if (res.count === 0) return { ok: false, error: "unknown" };
    revalidatePath("/app/supplies/suppliers");
    return { ok: true, id };
  } catch (e) {
    console.error("updateSupplier failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteSupplier(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    await tenantDb(ctx.organizationId).supplier.deleteMany({ where: { id } });
    revalidatePath("/app/supplies/suppliers");
    return { ok: true };
  } catch (e) {
    console.error("deleteSupplier failed", e);
    return { ok: false };
  }
}
