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
