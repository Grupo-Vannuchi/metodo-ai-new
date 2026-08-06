"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb, type TenantDb } from "@/lib/tenant-db";
import {
  stockMovementSchema,
  stockReservationSchema,
  type StockMovementInput,
} from "@/lib/validations/stock";

export type StockResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "unauthorized" | "invalid" | "unknown" | "insufficient" | "notReservable" | "state";
      available?: number;
    };

/** Signed physical balance of an item in a specific location (null = unspecified bucket). */
async function balanceAt(db: TenantDb, itemId: string, warehouseId: string | null): Promise<number> {
  const agg = await db.stockMovement.aggregate({ where: { itemId, warehouseId }, _sum: { qty: true } });
  return agg._sum.qty == null ? 0 : Number(agg._sum.qty);
}

/** Sum of currently-active reservations for an item in a location. */
async function reservedAt(db: TenantDb, itemId: string, warehouseId: string | null): Promise<number> {
  const agg = await db.stockReservation.aggregate({
    where: { itemId, warehouseId, status: "ACTIVE" },
    _sum: { qty: true },
  });
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

/**
 * Reserve stock. A reservation is a soft hold: it does not move physical stock,
 * it only lowers what's available. Blocks when the requested quantity exceeds
 * available (physical − active reservations) at the location.
 */
export async function createReservation(input: unknown): Promise<StockResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = stockReservationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  try {
    const db = tenantDb(ctx.organizationId);
    const item = await db.supplyItem.findFirst({
      where: { id: d.itemId },
      select: { id: true, canReserve: true },
    });
    if (!item) return { ok: false, error: "invalid" };
    if (!item.canReserve) return { ok: false, error: "notReservable" };

    const wh = d.warehouseId?.trim() || null;
    const [physical, reserved] = await Promise.all([balanceAt(db, item.id, wh), reservedAt(db, item.id, wh)]);
    const available = physical - reserved;
    if (available < d.quantity) return { ok: false, error: "insufficient", available };

    const s = (v?: string) => (v && v.trim() ? v.trim() : null);
    const res = await db.stockReservation.create({
      data: {
        organizationId: ctx.organizationId,
        itemId: item.id,
        warehouseId: wh,
        qty: d.quantity,
        status: "ACTIVE",
        reason: s(d.reason),
        reference: s(d.reference),
        note: s(d.note),
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    revalidatePath("/app/supplies/stock");
    return { ok: true, id: res.id };
  } catch (e) {
    console.error("createReservation failed", e);
    return { ok: false, error: "unknown" };
  }
}

/** Release an active reservation, freeing the held quantity back to available. */
export async function releaseReservation(id: string): Promise<StockResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const db = tenantDb(ctx.organizationId);
    const res = await db.stockReservation.findFirst({ where: { id }, select: { id: true, status: true } });
    if (!res) return { ok: false, error: "unknown" };
    if (res.status !== "ACTIVE") return { ok: false, error: "state" };
    await db.stockReservation.updateMany({ where: { id }, data: { status: "RELEASED", releasedAt: new Date() } });
    revalidatePath("/app/supplies/stock");
    return { ok: true, id };
  } catch (e) {
    console.error("releaseReservation failed", e);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Consume an active reservation: the held goods physically leave. Posts a stock
 * OUT movement for the reserved quantity and closes the reservation. Blocks when
 * physical stock is no longer enough to cover it.
 */
export async function consumeReservation(id: string): Promise<StockResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const db = tenantDb(ctx.organizationId);
    const res = await db.stockReservation.findFirst({ where: { id } });
    if (!res) return { ok: false, error: "unknown" };
    if (res.status !== "ACTIVE") return { ok: false, error: "state" };

    const qty = Number(res.qty);
    const physical = await balanceAt(db, res.itemId, res.warehouseId);
    if (physical < qty) return { ok: false, error: "insufficient", available: physical };

    await db.stockMovement.create({
      data: {
        organizationId: ctx.organizationId,
        itemId: res.itemId,
        warehouseId: res.warehouseId,
        type: "OUT",
        qty: -qty,
        reason: "reserva consumida",
        reference: res.reference,
        createdById: ctx.userId,
      },
    });
    await db.stockReservation.updateMany({ where: { id }, data: { status: "CONSUMED", consumedAt: new Date() } });
    revalidatePath("/app/supplies/stock");
    return { ok: true, id };
  } catch (e) {
    console.error("consumeReservation failed", e);
    return { ok: false, error: "unknown" };
  }
}
