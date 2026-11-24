import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { listTeamMembers } from "@/lib/queries/team-chat";
import type { SalesPeriod } from "@/lib/queries/sales-report";

/** Inclusive lower bound for a period, or null for "all time". */
function rangeStart(period: SalesPeriod): Date | null {
  const now = new Date();
  if (period === "30D") return new Date(now.getTime() - 30 * 86_400_000);
  if (period === "MONTH") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "YEAR") return new Date(now.getFullYear(), 0, 1);
  return null;
}

export type LeaderRow = {
  userId: string;
  name: string;
  wonValue: number;
  wonCount: number;
};

/** Won value per owner in the period — the sales leaderboard. Members with no
 * won deals in the window are dropped; sorted by value desc. */
export async function getSalesLeaderboard(
  organizationId: string,
  period: SalesPeriod,
): Promise<LeaderRow[]> {
  const db = tenantDb(organizationId);
  const start = rangeStart(period);
  const [members, won] = await Promise.all([
    listTeamMembers(organizationId),
    db.opportunity.groupBy({
      by: ["ownerId"],
      where: { status: "WON", ownerId: { not: null }, ...(start ? { updatedAt: { gte: start } } : {}) },
      _sum: { value: true },
      _count: { _all: true },
    }),
  ]);
  const byUser = new Map(
    won.map((w) => [w.ownerId as string, { value: Number(w._sum.value ?? 0), count: w._count._all }]),
  );
  return members
    .map((m) => ({
      userId: m.userId,
      name: m.name,
      wonValue: byUser.get(m.userId)?.value ?? 0,
      wonCount: byUser.get(m.userId)?.count ?? 0,
    }))
    .filter((r) => r.wonValue > 0 || r.wonCount > 0)
    .sort((a, b) => b.wonValue - a.wonValue);
}

export type TrendPoint = { month: string; wonValue: number; wonCount: number };

/** Won value per month for the last `months` months (oldest first). Buckets in
 * JS so empty months still appear (a flat bar). */
export async function getMonthlyTrend(
  organizationId: string,
  months = 6,
): Promise<TrendPoint[]> {
  const db = tenantDb(organizationId);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const opps = await db.opportunity.findMany({
    where: { status: "WON", updatedAt: { gte: start } },
    select: { value: true, updatedAt: true },
  });

  const buckets: TrendPoint[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1) + i, 1);
    buckets.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, wonValue: 0, wonCount: 0 });
  }
  const idx = new Map(buckets.map((b, i) => [b.month, i]));
  for (const o of opps) {
    const d = new Date(o.updatedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const i = idx.get(key);
    if (i != null) {
      buckets[i].wonValue += Number(o.value);
      buckets[i].wonCount += 1;
    }
  }
  return buckets;
}

/** A cap on the rows read for a ranking: enough for any real period, bounded for "all time". */
const RANKING_SCAN = 20_000;

export type TopProductRow = {
  key: string;
  name: string;
  /** Summed quantity over the proposal lines. */
  quantity: number;
  /** Summed line totals: the value quoted. */
  value: number;
  /** In how many proposals it appears. */
  proposals: number;
};

/**
 * Products and services most quoted in the proposals created in the period: summed quantity and value of
 * their proposal lines, and in how many proposals they appear. A catalog item groups by product (shown
 * with its catalog name); a free-text line groups by its name. Top `limit` by value.
 */
export async function getTopProducts(organizationId: string, period: SalesPeriod, limit = 8): Promise<TopProductRow[]> {
  const db = tenantDb(organizationId);
  const start = rangeStart(period);
  const items = await db.proposalItem.findMany({
    where: start ? { proposal: { createdAt: { gte: start } } } : {},
    select: { proposalId: true, productServiceId: true, name: true, quantity: true, total: true },
    orderBy: { createdAt: "desc" },
    take: RANKING_SCAN,
  });

  const acc = new Map<string, { name: string; productId: string | null; quantity: number; value: number; proposals: Set<string> }>();
  for (const it of items) {
    const name = it.name.trim();
    const key = it.productServiceId ? `p:${it.productServiceId}` : `n:${name.toLowerCase()}`;
    if (!it.productServiceId && !name) continue;
    const row = acc.get(key) ?? { name, productId: it.productServiceId, quantity: 0, value: 0, proposals: new Set<string>() };
    row.quantity += Number(it.quantity);
    row.value += Number(it.total);
    row.proposals.add(it.proposalId);
    acc.set(key, row);
  }

  const productIds = [...acc.values()].map((r) => r.productId).filter((id): id is string => !!id);
  const catalog = productIds.length
    ? await db.productService.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
    : [];
  const catalogName = new Map(catalog.map((p) => [p.id, p.name]));

  return [...acc.entries()]
    .map(([key, r]) => ({
      key,
      name: (r.productId && catalogName.get(r.productId)) || r.name || "—",
      quantity: Math.round(r.quantity * 100) / 100,
      value: Math.round(r.value * 100) / 100,
      proposals: r.proposals.size,
    }))
    .sort((a, b) => b.value - a.value || b.quantity - a.quantity)
    .slice(0, limit);
}

/** True when the text starts with a lowercase letter (accents included). */
function startsLower(text: string): boolean {
  const first = text.charAt(0);
  return first !== first.toUpperCase() && first === first.toLowerCase();
}

export type TopLocationRow = {
  key: string;
  /** "City/UF", or null for opportunities whose company has no city. */
  label: string | null;
  count: number;
  value: number;
};

/**
 * Where the funnel's opportunities are: the opportunities created in the period, grouped by the city/UF of
 * their client company (Company.address). Those without a company or a city fall into one "no city" row.
 * Top `limit` by count, then value.
 */
export async function getTopLocations(organizationId: string, period: SalesPeriod, limit = 8): Promise<TopLocationRow[]> {
  const db = tenantDb(organizationId);
  const start = rangeStart(period);
  const opps = await db.opportunity.findMany({
    where: start ? { createdAt: { gte: start } } : {},
    select: { value: true, company: { select: { address: true } } },
    orderBy: { createdAt: "desc" },
    take: RANKING_SCAN,
  });

  const acc = new Map<string, TopLocationRow>();
  for (const o of opps) {
    const address = (o.company?.address ?? {}) as { city?: unknown; uf?: unknown };
    const city = typeof address.city === "string" ? address.city.trim() : "";
    const uf = typeof address.uf === "string" ? address.uf.trim().toUpperCase() : "";
    const key = city ? `${city.toLowerCase()}|${uf}` : "";
    const label = city ? (uf ? `${city}/${uf}` : city) : null;
    const row = acc.get(key) ?? { key: key || "none", label, count: 0, value: 0 };
    // The same city typed in different cases is one row; show a spelling that starts with a capital.
    if (label && row.label && startsLower(row.label) && !startsLower(label)) row.label = label;
    row.count += 1;
    row.value += Number(o.value);
    acc.set(key, row);
  }

  return [...acc.values()]
    .map((r) => ({ ...r, value: Math.round(r.value * 100) / 100 }))
    .sort((a, b) => b.count - a.count || b.value - a.value)
    .slice(0, limit);
}
