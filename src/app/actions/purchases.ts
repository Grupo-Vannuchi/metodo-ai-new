"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb, type TenantDb } from "@/lib/tenant-db";
import { purchaseOrderSchema, receiveSchema, type PurchaseOrderInput } from "@/lib/validations/purchase";

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type PurchaseResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" | "state" | "nothing" };

const s = (v?: string) => (v && v.trim() ? v.trim() : null);

/** Keep only the ids that actually belong to the org, as a Set. */
async function validSupplier(db: TenantDb, id?: string): Promise<string | null> {
  const v = id?.trim();
  if (!v) return null;
  const row = await db.supplier.findFirst({ where: { id: v }, select: { id: true } });
  return row?.id ?? null;
}
async function validWarehouse(db: TenantDb, id?: string): Promise<string | null> {
  const v = id?.trim();
  if (!v) return null;
  const row = await db.warehouse.findFirst({ where: { id: v }, select: { id: true } });
  return row?.id ?? null;
}
async function validItemIds(db: TenantDb, ids: string[]): Promise<Set<string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Set();
  const rows = await db.supplyItem.findMany({ where: { id: { in: uniq } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** Build the nested line rows (org set explicitly — the extension skips nested creates). */
function lineRows(organizationId: string, input: PurchaseOrderInput, validItems: Set<string>) {
  return input.items.map((it, idx) => {
    const itemId = it.itemId && validItems.has(it.itemId) ? it.itemId : null;
    return {
      organizationId,
      itemId,
      description: it.description.trim(),
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      total: Number((it.quantity * it.unitPrice).toFixed(2)),
      order: idx,
    };
  });
}

function orderTotal(rows: { total: number }[]) {
  return Number(rows.reduce((sum, r) => sum + r.total, 0).toFixed(2));
}

async function nextCode(db: TenantDb): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const count = await db.purchaseOrder.count({ where: { code: { endsWith: `/${yy}` } } });
  return `${String(count + 1).padStart(4, "0")}/${yy}`;
}

export async function createPurchaseOrder(input: unknown): Promise<PurchaseResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = purchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  try {
    const db = tenantDb(ctx.organizationId);
    const [supplierId, warehouseId, validItems] = await Promise.all([
      validSupplier(db, d.supplierId),
      validWarehouse(db, d.warehouseId),
      validItemIds(db, d.items.map((i) => i.itemId ?? "")),
    ]);
    const rows = lineRows(ctx.organizationId, d, validItems);
    const code = await nextCode(db);

    const po = await db.purchaseOrder.create({
      data: {
        organizationId: ctx.organizationId,
        code,
        supplierId,
        warehouseId,
        status: "DRAFT",
        expectedAt: d.expectedAt ?? null,
        notes: s(d.notes),
        total: orderTotal(rows),
        createdById: ctx.userId,
        items: { create: rows },
      },
      select: { id: true },
    });
    revalidatePath("/app/supplies/purchases");
    return { ok: true, id: po.id };
  } catch (e) {
    console.error("createPurchaseOrder failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function updatePurchaseOrder(id: string, input: unknown): Promise<PurchaseResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = purchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  try {
    const db = tenantDb(ctx.organizationId);
    const po = await db.purchaseOrder.findFirst({ where: { id }, select: { id: true, status: true } });
    if (!po) return { ok: false, error: "unknown" };
    if (po.status !== "DRAFT") return { ok: false, error: "state" };

    const [supplierId, warehouseId, validItems] = await Promise.all([
      validSupplier(db, d.supplierId),
      validWarehouse(db, d.warehouseId),
      validItemIds(db, d.items.map((i) => i.itemId ?? "")),
    ]);
    const rows = lineRows(ctx.organizationId, d, validItems);

    await db.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
    await db.purchaseOrder.updateMany({
      where: { id },
      data: {
        supplierId,
        warehouseId,
        expectedAt: d.expectedAt ?? null,
        notes: s(d.notes),
        total: orderTotal(rows),
      },
    });
    await db.purchaseOrderItem.createMany({ data: rows.map((r) => ({ ...r, purchaseOrderId: id })) });
    revalidatePath("/app/supplies/purchases");
    revalidatePath(`/app/supplies/purchases/${id}`);
    return { ok: true, id };
  } catch (e) {
    console.error("updatePurchaseOrder failed", e);
    return { ok: false, error: "unknown" };
  }
}

const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  approve: { from: ["DRAFT"], to: "APPROVED" },
  order: { from: ["APPROVED"], to: "ORDERED" },
  cancel: { from: ["DRAFT", "APPROVED", "ORDERED", "PARTIAL"], to: "CANCELED" },
};

export async function setPurchaseOrderStatus(id: string, action: string): Promise<PurchaseResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const rule = TRANSITIONS[action];
  if (!rule) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const po = await db.purchaseOrder.findFirst({ where: { id }, select: { status: true } });
    if (!po) return { ok: false, error: "unknown" };
    if (!rule.from.includes(po.status)) return { ok: false, error: "state" };

    const data: Prisma.PurchaseOrderUpdateManyMutationInput = { status: rule.to as PurchaseOrderStatus };
    if (rule.to === "APPROVED") {
      data.approvedAt = new Date();
      data.approvedById = ctx.userId;
    } else if (rule.to === "ORDERED") {
      data.orderedAt = new Date();
    }
    await db.purchaseOrder.updateMany({ where: { id }, data });
    revalidatePath("/app/supplies/purchases");
    revalidatePath(`/app/supplies/purchases/${id}`);
    return { ok: true, id };
  } catch (e) {
    console.error("setPurchaseOrderStatus failed", e);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Receive quantities into stock. For each line, the received amount is clamped to
 * the remaining (ordered − already received). Lines linked to a stock-controlled
 * item post a StockMovement IN into the order's warehouse and refresh the item's
 * last cost; free lines just record the receipt. Status becomes RECEIVED when all
 * lines are complete, otherwise PARTIAL.
 */
export async function receivePurchaseOrder(id: string, input: unknown): Promise<PurchaseResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const po = await db.purchaseOrder.findFirst({ where: { id }, include: { items: true } });
    if (!po) return { ok: false, error: "unknown" };
    if (!["APPROVED", "ORDERED", "PARTIAL"].includes(po.status)) return { ok: false, error: "state" };

    const byId = new Map(po.items.map((i) => [i.id, i]));
    const itemIds = po.items.map((i) => i.itemId).filter(Boolean) as string[];
    const stockItems = itemIds.length
      ? await db.supplyItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, controlsStock: true } })
      : [];
    const controls = new Map(stockItems.map((s2) => [s2.id, s2.controlsStock]));

    const movements: {
      organizationId: string;
      itemId: string;
      warehouseId: string | null;
      type: "IN";
      qty: number;
      unitCost: number;
      reason: string;
      reference: string | null;
      createdById: string;
    }[] = [];
    const lineUpdates: { lineId: string; newReceived: number }[] = [];
    const costUpdates: { itemId: string; cost: number }[] = [];

    for (const { lineId, qty } of parsed.data.lines) {
      const line = byId.get(lineId);
      if (!line || qty <= 0) continue;
      const remaining = Number(line.quantity) - Number(line.receivedQty);
      const actual = Math.min(qty, Math.max(remaining, 0));
      if (actual <= 0) continue;

      lineUpdates.push({ lineId, newReceived: Number(line.receivedQty) + actual });
      if (line.itemId && controls.get(line.itemId)) {
        movements.push({
          organizationId: ctx.organizationId,
          itemId: line.itemId,
          warehouseId: po.warehouseId,
          type: "IN",
          qty: actual,
          unitCost: Number(line.unitPrice),
          reason: "compra",
          reference: po.code,
          createdById: ctx.userId,
        });
        costUpdates.push({ itemId: line.itemId, cost: Number(line.unitPrice) });
      }
    }

    if (!lineUpdates.length) return { ok: false, error: "nothing" };

    if (movements.length) await db.stockMovement.createMany({ data: movements });
    for (const u of lineUpdates) {
      await db.purchaseOrderItem.updateMany({ where: { id: u.lineId }, data: { receivedQty: u.newReceived } });
    }
    for (const c of costUpdates) {
      await db.supplyItem.updateMany({ where: { id: c.itemId }, data: { lastCost: c.cost } });
    }

    const fresh = po.items.map((i) => {
      const u = lineUpdates.find((x) => x.lineId === i.id);
      return { q: Number(i.quantity), r: u ? u.newReceived : Number(i.receivedQty) };
    });
    const allReceived = fresh.every((f) => f.r >= f.q);
    const anyReceived = fresh.some((f) => f.r > 0);
    const status = allReceived ? "RECEIVED" : anyReceived ? "PARTIAL" : po.status;

    await db.purchaseOrder.updateMany({
      where: { id },
      data: { status, receivedAt: allReceived ? new Date() : po.receivedAt },
    });
    revalidatePath("/app/supplies/purchases");
    revalidatePath(`/app/supplies/purchases/${id}`);
    revalidatePath("/app/supplies/stock");
    return { ok: true, id };
  } catch (e) {
    console.error("receivePurchaseOrder failed", e);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Post the order to the finance ledger as a payable (EXPENSE / PENDING), once.
 * Mirrors the payroll→finance bridge: raw prisma with explicit org, the created
 * entry's id is stored back on the order so it can't be posted twice. Only
 * committed orders (approved onward, not canceled) with a positive total qualify.
 */
export async function postPurchaseToFinance(id: string): Promise<PurchaseResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const org = ctx.organizationId;

  try {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id, organizationId: org },
      select: { id: true, code: true, status: true, total: true, supplierId: true, expectedAt: true, financeEntryId: true },
    });
    if (!po) return { ok: false, error: "unknown" };
    if (po.financeEntryId) return { ok: false, error: "state" };
    if (!["APPROVED", "ORDERED", "PARTIAL", "RECEIVED"].includes(po.status)) return { ok: false, error: "state" };
    const amount = money(Number(po.total));
    if (amount <= 0) return { ok: false, error: "nothing" };

    const supplier = po.supplierId
      ? await prisma.supplier.findFirst({ where: { id: po.supplierId, organizationId: org }, select: { name: true } })
      : null;
    const label = po.code ? `Compra OC ${po.code}` : "Compra";
    const description = supplier?.name ? `${label} — ${supplier.name}` : label;

    await prisma.$transaction(async (tx) => {
      const entry = await tx.financeEntry.create({
        data: {
          organizationId: org,
          type: "EXPENSE",
          description,
          amount,
          status: "PENDING",
          dueDate: po.expectedAt ?? new Date(),
          purchaseOrderId: po.id,
          createdById: ctx.userId,
        },
        select: { id: true },
      });
      await tx.purchaseOrder.updateMany({
        where: { id: po.id, organizationId: org },
        data: { financeEntryId: entry.id },
      });
    });

    revalidatePath("/app/supplies/purchases");
    revalidatePath(`/app/supplies/purchases/${id}`);
    revalidatePath("/app/finance/entries");
    return { ok: true, id };
  } catch (e) {
    console.error("postPurchaseToFinance failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function deletePurchaseOrder(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    const po = await db.purchaseOrder.findFirst({ where: { id }, select: { status: true } });
    if (!po) return { ok: false };
    if (!["DRAFT", "CANCELED"].includes(po.status)) return { ok: false };
    await db.purchaseOrder.deleteMany({ where: { id } });
    revalidatePath("/app/supplies/purchases");
    return { ok: true };
  } catch (e) {
    console.error("deletePurchaseOrder failed", e);
    return { ok: false };
  }
}
