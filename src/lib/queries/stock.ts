import "server-only";
import { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";

const dec = (v: Prisma.Decimal | null) => (v == null ? 0 : Number(v));

export type StockBalanceRow = {
  itemId: string;
  code: string | null;
  description: string;
  unit: string | null;
  balance: number;
  reserved: number;
  available: number;
  minStock: number | null;
  belowMin: boolean;
};

/**
 * Current balance per item = Σ signed qty across every movement of the item.
 * Items that control stock are always listed (balance 0 if no movements yet);
 * additionally any item with movements is included even if the flag was later
 * turned off, so nothing silently disappears from the ledger view.
 */
export async function getStockBalances(organizationId: string, search?: string): Promise<StockBalanceRow[]> {
  const db = tenantDb(organizationId);

  const [sums, reservedSums, items] = await Promise.all([
    db.stockMovement.groupBy({ by: ["itemId"], _sum: { qty: true } }),
    db.stockReservation.groupBy({ by: ["itemId"], where: { status: "ACTIVE" }, _sum: { qty: true } }),
    db.supplyItem.findMany({
      where: { OR: [{ controlsStock: true }, { active: true }] },
      select: { id: true, code: true, description: true, unit: true, minStock: true, controlsStock: true },
      take: 2000,
    }),
  ]);

  const balanceOf = new Map(sums.map((s) => [s.itemId, dec(s._sum.qty)]));
  const reservedOf = new Map(reservedSums.map((s) => [s.itemId, dec(s._sum.qty)]));
  const term = (search ?? "").trim().toLowerCase();

  const rows: StockBalanceRow[] = items
    .filter((i) => i.controlsStock || balanceOf.has(i.id) || reservedOf.has(i.id))
    .map((i) => {
      const min = i.minStock == null ? null : Number(i.minStock);
      const balance = balanceOf.get(i.id) ?? 0;
      const reserved = reservedOf.get(i.id) ?? 0;
      return {
        itemId: i.id,
        code: i.code,
        description: i.description,
        unit: i.unit,
        balance,
        reserved,
        available: balance - reserved,
        minStock: min,
        belowMin: min != null && balance < min,
      };
    })
    .filter((r) =>
      term ? r.description.toLowerCase().includes(term) || (r.code ?? "").toLowerCase().includes(term) : true,
    );

  rows.sort((a, b) => {
    // Below-minimum first, then by description.
    if (a.belowMin !== b.belowMin) return a.belowMin ? -1 : 1;
    return a.description.localeCompare(b.description);
  });
  return rows;
}

export type StockMovementRow = {
  id: string;
  createdAt: Date;
  type: string;
  itemDescription: string;
  warehouseName: string | null;
  qty: number;
  reason: string | null;
  reference: string | null;
  reversed: boolean;
};

/** Recent movements for the ledger view, with item/warehouse names resolved. */
export async function listStockMovements(
  organizationId: string,
  opts?: { limit?: number; itemId?: string },
): Promise<StockMovementRow[]> {
  const db = tenantDb(organizationId);
  const moves = await db.stockMovement.findMany({
    where: opts?.itemId ? { itemId: opts.itemId } : {},
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 200,
  });

  const itemIds = [...new Set(moves.map((m) => m.itemId))];
  const whIds = [...new Set(moves.map((m) => m.warehouseId).filter(Boolean))] as string[];
  const reversedIds = new Set(moves.map((m) => m.reversalOfId).filter(Boolean) as string[]);

  const [items, whs] = await Promise.all([
    itemIds.length
      ? db.supplyItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, description: true } })
      : Promise.resolve([]),
    whIds.length
      ? db.warehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const itemName = new Map(items.map((i) => [i.id, i.description]));
  const whName = new Map(whs.map((w) => [w.id, w.name]));

  return moves.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    type: m.type,
    itemDescription: itemName.get(m.itemId) ?? "—",
    warehouseName: m.warehouseId ? whName.get(m.warehouseId) ?? null : null,
    qty: Number(m.qty),
    reason: m.reason,
    reference: m.reference,
    reversed: reversedIds.has(m.id),
  }));
}

/** Items (that control stock) + warehouses, as options for the movement form. */
export async function stockFormOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  const [items, warehouses] = await Promise.all([
    db.supplyItem.findMany({
      where: { active: true, controlsStock: true },
      orderBy: { description: "asc" },
      select: { id: true, description: true, code: true, unit: true },
      take: 2000,
    }),
    db.warehouse.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 1000,
    }),
  ]);
  return {
    items: items.map((i) => ({ id: i.id, label: i.code ? `${i.code} · ${i.description}` : i.description, unit: i.unit })),
    warehouses,
  };
}

export type StockFormOptions = Awaited<ReturnType<typeof stockFormOptions>>;

export type ReservationRow = {
  id: string;
  createdAt: Date;
  status: string;
  itemDescription: string;
  warehouseName: string | null;
  qty: number;
  reason: string | null;
  reference: string | null;
};

/** Reservations for the reservations tab (active first, then recent history). */
export async function listReservations(organizationId: string, limit = 200): Promise<ReservationRow[]> {
  const db = tenantDb(organizationId);
  const res = await db.stockReservation.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: limit,
  });

  const itemIds = [...new Set(res.map((r) => r.itemId))];
  const whIds = [...new Set(res.map((r) => r.warehouseId).filter(Boolean))] as string[];
  const [items, whs] = await Promise.all([
    itemIds.length
      ? db.supplyItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, description: true } })
      : Promise.resolve([]),
    whIds.length
      ? db.warehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const itemName = new Map(items.map((i) => [i.id, i.description]));
  const whName = new Map(whs.map((w) => [w.id, w.name]));

  return res.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    status: r.status,
    itemDescription: itemName.get(r.itemId) ?? "—",
    warehouseName: r.warehouseId ? whName.get(r.warehouseId) ?? null : null,
    qty: Number(r.qty),
    reason: r.reason,
    reference: r.reference,
  }));
}

/** Items that can be reserved + warehouses, for the reservation form. */
export async function reservationFormOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  const [items, warehouses] = await Promise.all([
    db.supplyItem.findMany({
      where: { active: true, canReserve: true },
      orderBy: { description: "asc" },
      select: { id: true, description: true, code: true, unit: true },
      take: 2000,
    }),
    db.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 1000 }),
  ]);
  return {
    items: items.map((i) => ({ id: i.id, label: i.code ? `${i.code} · ${i.description}` : i.description, unit: i.unit })),
    warehouses,
  };
}

export type ReservationFormOptions = Awaited<ReturnType<typeof reservationFormOptions>>;
