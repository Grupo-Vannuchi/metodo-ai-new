import "server-only";
import type { AssetStatus, Prisma, PurchaseOrderStatus, StockMovementType } from "@prisma/client";
import { money, qty, type Period } from "@/lib/mcp/core";
import { getStockBalances } from "@/lib/queries/stock";
import { getSupplyIndicators } from "@/lib/queries/supply-indicators";
import { tenantDb } from "@/lib/tenant-db";

/**
 * Supplies reads of the MCP server. Stock balances and the indicators come
 * from the same DAL functions as the Suprimentos screens, so the numbers
 * match; free-text notes never leave.
 */

type Page = { take: number; skip: number };
type Range = { gte?: Date; lt?: Date } | null;

const insensitive = (s: string) => ({ contains: s, mode: "insensitive" as const });
const uniqueIds = (ids: (string | null)[]) => [...new Set(ids.filter((id): id is string => Boolean(id)))];

export async function searchStock(organizationId: string, a: { search?: string; belowMin?: boolean; page: Page }) {
  const rows = (await getStockBalances(organizationId, a.search)).filter(
    (r) => a.belowMin === undefined || r.belowMin === a.belowMin,
  );
  return {
    total: rows.length,
    items: rows.slice(a.page.skip, a.page.skip + a.page.take).map((r) => ({
      itemId: r.itemId,
      code: r.code,
      description: r.description,
      unit: r.unit,
      balance: qty(r.balance),
      reserved: qty(r.reserved),
      available: qty(r.available),
      minStock: qty(r.minStock),
      belowMin: r.belowMin,
    })),
  };
}

/** Names of items and warehouses, which StockMovement/PurchaseOrder keep as bare ids. */
async function itemAndWarehouseNames(organizationId: string, itemIds: string[], warehouseIds: string[]) {
  const db = tenantDb(organizationId);
  const [items, warehouses] = await Promise.all([
    itemIds.length
      ? db.supplyItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, description: true } })
      : Promise.resolve([]),
    warehouseIds.length
      ? db.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  return {
    item: new Map(items.map((i) => [i.id, i.description])),
    warehouse: new Map(warehouses.map((w) => [w.id, w.name])),
  };
}

export async function searchMovements(
  organizationId: string,
  a: { itemId?: string; warehouseId?: string; type?: StockMovementType; range: Range; page: Page },
) {
  const db = tenantDb(organizationId);
  const where: Prisma.StockMovementWhereInput = {
    itemId: a.itemId,
    warehouseId: a.warehouseId,
    type: a.type,
    ...(a.range ? { createdAt: a.range } : {}),
  };
  const [total, rows] = await Promise.all([
    db.stockMovement.count({ where }),
    db.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...a.page,
      select: {
        id: true,
        createdAt: true,
        type: true,
        qty: true,
        unitCost: true,
        lot: true,
        validity: true,
        itemId: true,
        warehouseId: true,
        reason: true,
        reference: true,
      },
    }),
  ]);
  const names = await itemAndWarehouseNames(
    organizationId,
    uniqueIds(rows.map((m) => m.itemId)),
    uniqueIds(rows.map((m) => m.warehouseId)),
  );
  return {
    total,
    items: rows.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      type: m.type,
      qty: qty(m.qty),
      unitCost: money(m.unitCost),
      lot: m.lot,
      validity: m.validity,
      itemId: m.itemId,
      itemDescription: names.item.get(m.itemId) ?? null,
      warehouseName: m.warehouseId ? (names.warehouse.get(m.warehouseId) ?? null) : null,
      reason: m.reason,
      reference: m.reference,
    })),
  };
}

export async function searchPurchaseOrders(
  organizationId: string,
  a: { status?: PurchaseOrderStatus; supplierId?: string; range: Range; page: Page },
) {
  const db = tenantDb(organizationId);
  const where: Prisma.PurchaseOrderWhereInput = {
    status: a.status,
    supplierId: a.supplierId,
    ...(a.range ? { createdAt: a.range } : {}),
  };
  const [total, rows] = await Promise.all([
    db.purchaseOrder.count({ where }),
    db.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...a.page,
      select: {
        id: true,
        code: true,
        status: true,
        supplierId: true,
        warehouseId: true,
        total: true,
        expectedAt: true,
        approvedAt: true,
        orderedAt: true,
        receivedAt: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    }),
  ]);
  const supplierIds = uniqueIds(rows.map((o) => o.supplierId));
  const [suppliers, names] = await Promise.all([
    supplierIds.length
      ? db.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    itemAndWarehouseNames(organizationId, [], uniqueIds(rows.map((o) => o.warehouseId))),
  ]);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  return {
    total,
    items: rows.map((o) => ({
      id: o.id,
      code: o.code,
      status: o.status,
      supplierName: o.supplierId ? (supplierName.get(o.supplierId) ?? null) : null,
      warehouseName: o.warehouseId ? (names.warehouse.get(o.warehouseId) ?? null) : null,
      total: money(o.total),
      itemCount: o._count.items,
      expectedAt: o.expectedAt,
      approvedAt: o.approvedAt,
      orderedAt: o.orderedAt,
      receivedAt: o.receivedAt,
      createdAt: o.createdAt,
    })),
  };
}

export async function searchAssets(
  organizationId: string,
  a: { status?: AssetStatus; search?: string; page: Page },
) {
  const db = tenantDb(organizationId);
  const where: Prisma.AssetWhereInput = {
    status: a.status,
    ...(a.search
      ? { OR: [{ name: insensitive(a.search) }, { code: insensitive(a.search) }, { serialNumber: insensitive(a.search) }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    db.asset.count({ where }),
    db.asset.findMany({
      where,
      orderBy: { name: "asc" },
      ...a.page,
      select: {
        id: true,
        code: true,
        name: true,
        serialNumber: true,
        nature: true,
        status: true,
        location: true,
        custodian: true,
        acquisitionDate: true,
        acquisitionValue: true,
        maintenanceEvents: {
          where: { status: "SCHEDULED" },
          orderBy: { dueDate: "asc" },
          take: 1,
          select: { type: true, dueDate: true },
        },
      },
    }),
  ]);
  return {
    total,
    items: rows.map(({ maintenanceEvents, ...asset }) => ({
      ...asset,
      acquisitionValue: money(asset.acquisitionValue),
      nextMaintenance: maintenanceEvents[0] ?? null,
    })),
  };
}

/** The Suprimentos indicators as the home screen shows them, plus the period's activity. */
export async function suppliesSummary(organizationId: string, period: Period) {
  const db = tenantDb(organizationId);
  const inPeriod = { gte: period.gte, lt: period.lt };
  const [indicators, purchases, movements, serviceTickets] = await Promise.all([
    getSupplyIndicators(organizationId),
    db.purchaseOrder.groupBy({
      by: ["status"],
      where: { createdAt: inPeriod },
      _count: { _all: true },
      _sum: { total: true },
    }),
    db.stockMovement.groupBy({ by: ["type"], where: { createdAt: inPeriod }, _count: { _all: true } }),
    db.serviceTicket.groupBy({ by: ["status"], where: { receivedAt: inPeriod }, _count: { _all: true } }),
  ]);
  return {
    period: { from: period.from, to: period.to },
    indicators,
    purchases: purchases.map((g) => ({ status: g.status, count: g._count._all, total: money(g._sum.total ?? 0) })),
    movements: movements.map((g) => ({ type: g.type, count: g._count._all })),
    serviceTickets: serviceTickets.map((g) => ({ status: g.status, count: g._count._all })),
  };
}
