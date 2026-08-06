"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb, type TenantDb } from "@/lib/tenant-db";
import { stockMovementSchema, type StockMovementInput } from "@/lib/validations/stock";

export type StockResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" | "insufficient"; available?: number };

/** Signed balance of an item in a specific location (null = unspecified bucket). */
async function balanceAt(db: TenantDb, itemId: string, warehouseId: string | null): Promise<number> {
  const agg = await db.stockMovement.aggregate({ where: { itemId, warehouseId }, _sum: { qty: true } });
  return agg._sum.qty == null ? 0 : Number(agg._sum.qty);
}

/** Verify the item exists in the org and controls stock; returns its id or null. */
async function resolveStockItem(db: TenantDb, itemId: string): Promise<string | null> {
  const item = await db.supplyItem.findFirst({ where: { id: itemId }, select: { id: true } });
  return item?.id ?? null;
}

function meta(d: StockMovementInput) {
  const s = (v?: string) => (v && v.trim() ? v.trim() : null);
  return {
    lot: s(d.lot),
    validity: d.validity ?? null,
    unitCost: d.unitCost ?? null,
    reason: s(d.reason),
    reference: s(d.reference),
    note: s(d.note),
  };
}

export async function createStockMovement(input: unknown): Promise<StockResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = stockMovementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  try {
    const db = tenantDb(ctx.organizationId);
    const itemId = await resolveStockItem(db, d.itemId);
    if (!itemId) return { ok: false, error: "invalid" };

    const src = d.warehouseId?.trim() || null;
    const dst = d.toWarehouseId?.trim() || null;
    const base = { organizationId: ctx.organizationId, itemId, createdById: ctx.userId, ...meta(d) };

    if (d.kind === "TRANSFER") {
      const available = await balanceAt(db, itemId, src);
      if (available < d.quantity) return { ok: false, error: "insufficient", available };
      const group = crypto.randomUUID();
      await db.stockMovement.createMany({
        data: [
          { ...base, type: "TRANSFER_OUT", warehouseId: src, qty: -d.quantity, transferGroupId: group },
          { ...base, type: "TRANSFER_IN", warehouseId: dst, qty: d.quantity, transferGroupId: group },
        ],
      });
      revalidatePath("/app/supplies/stock");
      return { ok: true, id: group };
    }

    // IN raises, OUT/ADJUST-decrease lower. ADJUST honours the chosen direction.
    const decreases = d.kind === "OUT" || (d.kind === "ADJUST" && d.adjustDirection === "decrease");
    const signedQty = decreases ? -d.quantity : d.quantity;

    if (decreases) {
      const available = await balanceAt(db, itemId, src);
      if (available < d.quantity) return { ok: false, error: "insufficient", available };
    }

    const move = await db.stockMovement.create({
      data: { ...base, type: d.kind, warehouseId: src, qty: signedQty },
      select: { id: true },
    });
    revalidatePath("/app/supplies/stock");
    return { ok: true, id: move.id };
  } catch (e) {
    console.error("createStockMovement failed", e);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Reverse a movement by appending its inverse (never a delete). For a transfer,
 * both legs are reversed together. Refuses if the movement is itself a reversal
 * or has already been reversed.
 */
export async function reverseStockMovement(id: string): Promise<StockResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const db = tenantDb(ctx.organizationId);
    const move = await db.stockMovement.findFirst({ where: { id } });
    if (!move) return { ok: false, error: "unknown" };
    if (move.reversalOfId) return { ok: false, error: "invalid" };
    const already = await db.stockMovement.findFirst({ where: { reversalOfId: id }, select: { id: true } });
    if (already) return { ok: false, error: "invalid" };

    const legs = move.transferGroupId
      ? await db.stockMovement.findMany({ where: { transferGroupId: move.transferGroupId, reversalOfId: null } })
      : [move];

    await db.stockMovement.createMany({
      data: legs.map((m) => ({
        organizationId: ctx.organizationId,
        itemId: m.itemId,
        warehouseId: m.warehouseId,
        type: m.type,
        qty: m.qty.negated(),
        lot: m.lot,
        validity: m.validity,
        unitCost: m.unitCost,
        reason: "estorno",
        reference: m.reference,
        note: m.note,
        transferGroupId: m.transferGroupId,
        reversalOfId: m.id,
        createdById: ctx.userId,
      })),
    });
    revalidatePath("/app/supplies/stock");
    return { ok: true, id };
  } catch (e) {
    console.error("reverseStockMovement failed", e);
    return { ok: false, error: "unknown" };
  }
}
