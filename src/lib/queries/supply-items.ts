import "server-only";
import { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";

export type SupplyItemRow = {
  id: string;
  code: string | null;
  description: string;
  type: string;
  nature: string;
  unit: string | null;
  category: string | null;
  salePrice: number | null;
  active: boolean;
  supplierName: string | null;
};

/** List items for the registry, optionally filtered by a search term. */
export async function listSupplyItems(organizationId: string, search?: string): Promise<SupplyItemRow[]> {
  const db = tenantDb(organizationId);
  const term = (search ?? "").trim();
  const c = { contains: term, mode: "insensitive" as const };
  const where: Prisma.SupplyItemWhereInput = term
    ? { OR: [{ description: c }, { code: c }, { barcode: c }, { brand: c }] }
    : {};

  const items = await db.supplyItem.findMany({
    where,
    orderBy: [{ active: "desc" }, { description: "asc" }],
    take: 500,
    select: {
      id: true,
      code: true,
      description: true,
      type: true,
      nature: true,
      unit: true,
      category: true,
      salePrice: true,
      active: true,
      supplierId: true,
    },
  });

  const supIds = [...new Set(items.map((i) => i.supplierId).filter(Boolean))] as string[];
  const sups = supIds.length
    ? await db.supplier.findMany({ where: { id: { in: supIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(sups.map((s) => [s.id, s.name]));

  return items.map((i) => ({
    id: i.id,
    code: i.code,
    description: i.description,
    type: i.type,
    nature: i.nature,
    unit: i.unit,
    category: i.category,
    salePrice: i.salePrice == null ? null : Number(i.salePrice),
    active: i.active,
    supplierName: i.supplierId ? nameOf.get(i.supplierId) ?? null : null,
  }));
}

/** Active suppliers as options for the item form. */
export async function supplierOptions(organizationId: string) {
  return tenantDb(organizationId).supplier.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 1000,
  });
}

const dec = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));

/** A single item with Decimals coerced to numbers for the form. */
export async function getSupplyItem(organizationId: string, id: string) {
  const item = await tenantDb(organizationId).supplyItem.findFirst({ where: { id } });
  if (!item) return null;
  return {
    ...item,
    minStock: dec(item.minStock),
    maxStock: dec(item.maxStock),
    reorderPoint: dec(item.reorderPoint),
    lastCost: dec(item.lastCost),
    avgCost: dec(item.avgCost),
    salePrice: dec(item.salePrice),
    rentPrice: dec(item.rentPrice),
    weight: dec(item.weight),
  };
}

export type SupplyItemDetail = NonNullable<Awaited<ReturnType<typeof getSupplyItem>>>;
