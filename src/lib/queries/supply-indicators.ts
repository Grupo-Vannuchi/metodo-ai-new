import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type SupplyIndicators = {
  stock: { belowMin: number; totalValue: number; reservations: number };
  purchases: { openCount: number; openValue: number; receivableCount: number };
  assets: { total: number; available: number; inUse: number; maintenance: number; totalValue: number };
  maintenance: { overdue: number; upcoming30: number };
  clientEquipment: { inHouse: number };
};

/** Cross-module KPIs for the supplies home dashboard. */
export async function getSupplyIndicators(organizationId: string): Promise<SupplyIndicators> {
  const db = tenantDb(organizationId);
  const now = new Date();
  const in30 = new Date(now);
  in30.setDate(now.getDate() + 30);

  const [items, movementSums, reservations, poOpen, poReceivable, assetGroups, assetValue, overdue, upcoming30, inHouse] =
    await Promise.all([
      db.supplyItem.findMany({
        where: { controlsStock: true },
        select: { id: true, minStock: true, avgCost: true, lastCost: true },
      }),
      db.stockMovement.groupBy({ by: ["itemId"], _sum: { qty: true } }),
      db.stockReservation.count({ where: { status: "ACTIVE" } }),
      db.purchaseOrder.aggregate({
        where: { status: { in: ["DRAFT", "APPROVED", "ORDERED", "PARTIAL"] } },
        _count: true,
        _sum: { total: true },
      }),
      db.purchaseOrder.count({ where: { status: { in: ["ORDERED", "PARTIAL"] } } }),
      db.asset.groupBy({ by: ["status"], where: { active: true }, _count: true }),
      db.asset.aggregate({ where: { active: true }, _sum: { acquisitionValue: true } }),
      db.maintenanceEvent.count({ where: { status: "SCHEDULED", dueDate: { lt: now } } }),
      db.maintenanceEvent.count({ where: { status: "SCHEDULED", dueDate: { gte: now, lte: in30 } } }),
      db.serviceTicket.count({ where: { status: { in: ["RECEIVED", "IN_SERVICE", "READY"] } } }),
    ]);

  const balanceOf = new Map(movementSums.map((m) => [m.itemId, m._sum.qty == null ? 0 : Number(m._sum.qty)]));
  let belowMin = 0;
  let totalValue = 0;
  for (const it of items) {
    const balance = balanceOf.get(it.id) ?? 0;
    const min = it.minStock == null ? null : Number(it.minStock);
    if (min != null && balance < min) belowMin += 1;
    const cost = it.avgCost != null ? Number(it.avgCost) : it.lastCost != null ? Number(it.lastCost) : 0;
    if (balance > 0 && cost > 0) totalValue += balance * cost;
  }

  const assetCount = (status: string) => assetGroups.find((g) => g.status === status)?._count ?? 0;

  return {
    stock: {
      belowMin,
      totalValue: Math.round(totalValue * 100) / 100,
      reservations,
    },
    purchases: {
      openCount: poOpen._count,
      openValue: poOpen._sum.total == null ? 0 : Number(poOpen._sum.total),
      receivableCount: poReceivable,
    },
    assets: {
      total: assetGroups.reduce((sum, g) => sum + g._count, 0),
      available: assetCount("AVAILABLE"),
      inUse: assetCount("IN_USE"),
      maintenance: assetCount("MAINTENANCE"),
      totalValue: assetValue._sum.acquisitionValue == null ? 0 : Number(assetValue._sum.acquisitionValue),
    },
    maintenance: {
      overdue,
      upcoming30,
    },
    clientEquipment: {
      inHouse,
    },
  };
}
