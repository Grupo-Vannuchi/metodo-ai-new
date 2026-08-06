import "server-only";
import { Prisma, type PurchaseOrderStatus } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";

const dec = (v: Prisma.Decimal | null) => (v == null ? 0 : Number(v));

export type PurchaseOrderRow = {
  id: string;
  code: string | null;
  status: string;
  supplierName: string | null;
  total: number;
  itemCount: number;
  expectedAt: Date | null;
  createdAt: Date;
};

/** List purchase orders, optionally filtered by status. */
export async function listPurchaseOrders(organizationId: string, status?: string): Promise<PurchaseOrderRow[]> {
  const db = tenantDb(organizationId);
  const where: Prisma.PurchaseOrderWhereInput =
    status && status !== "ALL" ? { status: status as PurchaseOrderStatus } : {};

  const orders = await db.purchaseOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      code: true,
      status: true,
      supplierId: true,
      total: true,
      expectedAt: true,
      createdAt: true,
      _count: { select: { items: true } },
    },
  });

  const supIds = [...new Set(orders.map((o) => o.supplierId).filter(Boolean))] as string[];
  const sups = supIds.length
    ? await db.supplier.findMany({ where: { id: { in: supIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(sups.map((s) => [s.id, s.name]));

  return orders.map((o) => ({
    id: o.id,
    code: o.code,
    status: o.status,
    supplierName: o.supplierId ? nameOf.get(o.supplierId) ?? null : null,
    total: dec(o.total),
    itemCount: o._count.items,
    expectedAt: o.expectedAt,
    createdAt: o.createdAt,
  }));
}

export type PurchaseOrderItemDetail = {
  id: string;
  itemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  receivedQty: number;
  order: number;
};

export type PurchaseOrderDetail = {
  id: string;
  code: string | null;
  status: string;
  supplierId: string | null;
  supplierName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  expectedAt: Date | null;
  notes: string | null;
  total: number;
  approvedAt: Date | null;
  orderedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
  items: PurchaseOrderItemDetail[];
};

/** A single purchase order with its lines and resolved supplier/warehouse names. */
export async function getPurchaseOrder(organizationId: string, id: string): Promise<PurchaseOrderDetail | null> {
  const db = tenantDb(organizationId);
  const o = await db.purchaseOrder.findFirst({
    where: { id },
    include: { items: { orderBy: { order: "asc" } } },
  });
  if (!o) return null;

  const [supplier, warehouse] = await Promise.all([
    o.supplierId
      ? db.supplier.findFirst({ where: { id: o.supplierId }, select: { name: true } })
      : Promise.resolve(null),
    o.warehouseId
      ? db.warehouse.findFirst({ where: { id: o.warehouseId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  return {
    id: o.id,
    code: o.code,
    status: o.status,
    supplierId: o.supplierId,
    supplierName: supplier?.name ?? null,
    warehouseId: o.warehouseId,
    warehouseName: warehouse?.name ?? null,
    expectedAt: o.expectedAt,
    notes: o.notes,
    total: dec(o.total),
    approvedAt: o.approvedAt,
    orderedAt: o.orderedAt,
    receivedAt: o.receivedAt,
    createdAt: o.createdAt,
    items: o.items.map((i) => ({
      id: i.id,
      itemId: i.itemId,
      description: i.description,
      quantity: dec(i.quantity),
      unitPrice: dec(i.unitPrice),
      total: dec(i.total),
      receivedQty: dec(i.receivedQty),
      order: i.order,
    })),
  };
}

/** Suppliers + purchasable items + warehouses for the purchase form. */
export async function purchaseFormOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  const [suppliers, items, warehouses] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 1000 }),
    db.supplyItem.findMany({
      where: { active: true },
      orderBy: { description: "asc" },
      select: { id: true, description: true, code: true, unit: true, lastCost: true, controlsStock: true },
      take: 2000,
    }),
    db.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 1000 }),
  ]);
  return {
    suppliers,
    warehouses,
    items: items.map((i) => ({
      id: i.id,
      label: i.code ? `${i.code} · ${i.description}` : i.description,
      description: i.description,
      unit: i.unit,
      lastCost: i.lastCost == null ? null : Number(i.lastCost),
      controlsStock: i.controlsStock,
    })),
  };
}

export type PurchaseFormOptions = Awaited<ReturnType<typeof purchaseFormOptions>>;
