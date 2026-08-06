import "server-only";
import { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";

const dec = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));

export type AssetRow = {
  id: string;
  code: string | null;
  name: string;
  serialNumber: string | null;
  nature: string;
  status: string;
  location: string | null;
  itemName: string | null;
  ownerCompanyName: string | null;
  active: boolean;
};

/** List assets, optionally filtered by a search term. */
export async function listAssets(organizationId: string, search?: string): Promise<AssetRow[]> {
  const db = tenantDb(organizationId);
  const term = (search ?? "").trim();
  const c = { contains: term, mode: "insensitive" as const };
  const where: Prisma.AssetWhereInput = term
    ? { OR: [{ name: c }, { code: c }, { serialNumber: c }, { custodian: c }] }
    : {};

  const assets = await db.asset.findMany({
    where,
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take: 1000,
    select: {
      id: true,
      code: true,
      name: true,
      serialNumber: true,
      nature: true,
      status: true,
      location: true,
      active: true,
      itemId: true,
      ownerCompanyId: true,
    },
  });

  const itemIds = [...new Set(assets.map((a) => a.itemId).filter(Boolean))] as string[];
  const companyIds = [...new Set(assets.map((a) => a.ownerCompanyId).filter(Boolean))] as string[];
  const [items, companies] = await Promise.all([
    itemIds.length
      ? db.supplyItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, description: true } })
      : Promise.resolve([]),
    companyIds.length
      ? db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const itemName = new Map(items.map((i) => [i.id, i.description]));
  const companyName = new Map(companies.map((co) => [co.id, co.name]));

  return assets.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    serialNumber: a.serialNumber,
    nature: a.nature,
    status: a.status,
    location: a.location,
    itemName: a.itemId ? itemName.get(a.itemId) ?? null : null,
    ownerCompanyName: a.ownerCompanyId ? companyName.get(a.ownerCompanyId) ?? null : null,
    active: a.active,
  }));
}

/** A single asset with Decimals coerced to numbers for the form. */
export async function getAsset(organizationId: string, id: string) {
  const asset = await tenantDb(organizationId).asset.findFirst({ where: { id } });
  if (!asset) return null;
  return { ...asset, acquisitionValue: dec(asset.acquisitionValue) };
}

export type AssetDetail = NonNullable<Awaited<ReturnType<typeof getAsset>>>;

/** Catalog items + suppliers + warehouses + companies for the asset form. */
export async function assetFormOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  const [items, suppliers, warehouses, companies] = await Promise.all([
    db.supplyItem.findMany({
      where: { active: true },
      orderBy: { description: "asc" },
      select: { id: true, description: true, code: true },
      take: 2000,
    }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 1000 }),
    db.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 1000 }),
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 2000 }),
  ]);
  return {
    items: items.map((i) => ({ id: i.id, label: i.code ? `${i.code} · ${i.description}` : i.description })),
    suppliers,
    warehouses,
    companies,
  };
}

export type AssetFormOptions = Awaited<ReturnType<typeof assetFormOptions>>;
