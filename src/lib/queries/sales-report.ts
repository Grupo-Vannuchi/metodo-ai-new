import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type SalesPeriod = "30D" | "MONTH" | "YEAR" | "ALL";

export type SalesReport = {
  won: number;
  lost: number;
  canceled: number;
  /** won / (won + lost) — cancellations don't count as a competitive loss. */
  winRate: number;
  wonValue: number;
  /** Average won-deal value. */
  avgTicket: number;
  /** Average days from creation to close, over won deals that have a close date. */
  avgCycleDays: number | null;
  /** Why deals were lost/canceled, by `outcomeReason`, most frequent first. */
  lossReasons: { reason: string; count: number }[];
  /** Current open pipeline, by stage — where deals sit right now. */
  funnel: { id: string; name: string; count: number; value: number }[];
};

/** Inclusive lower bound for the period, or null for "all time". */
function rangeStart(period: SalesPeriod): Date | null {
  const now = new Date();
  if (period === "30D") return new Date(now.getTime() - 30 * 86_400_000);
  if (period === "MONTH") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "YEAR") return new Date(now.getFullYear(), 0, 1);
  return null;
}

const DAY = 86_400_000;

/** Win/loss analytics over a period. Reads scoped to the org via `tenantDb`. */
export async function getSalesReport(
  organizationId: string,
  period: SalesPeriod,
  pipelineId?: string,
): Promise<SalesReport> {
  const db = tenantDb(organizationId);
  const start = rangeStart(period);
  const closedWhere = start ? { updatedAt: { gte: start } } : {};

  const pipeline =
    (pipelineId ? await db.pipeline.findFirst({ where: { id: pipelineId }, select: { id: true } }) : null) ??
    (await db.pipeline.findFirst({ where: { isDefault: true }, orderBy: { order: "asc" }, select: { id: true } })) ??
    (await db.pipeline.findFirst({ orderBy: { order: "asc" }, select: { id: true } }));

  const [wonOpps, lost, canceled, lossGroups, stages, openGroups] = await Promise.all([
    db.opportunity.findMany({
      where: { status: "WON", ...closedWhere },
      select: { value: true, createdAt: true, closedAt: true, updatedAt: true },
    }),
    db.opportunity.count({ where: { status: "LOST", ...closedWhere } }),
    db.opportunity.count({ where: { status: "CANCELED", ...closedWhere } }),
    db.opportunity.groupBy({
      by: ["outcomeReason"],
      where: { status: { in: ["LOST", "CANCELED"] }, outcomeReason: { not: null }, ...closedWhere },
      _count: { _all: true },
    }),
    pipeline
      ? db.stage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { order: "asc" }, select: { id: true, name: true } })
      : [],
    pipeline
      ? db.opportunity.groupBy({
          by: ["stageId"],
          where: { pipelineId: pipeline.id, status: "OPEN" },
          _count: { _all: true },
          _sum: { value: true },
        })
      : [],
  ]);

  const won = wonOpps.length;
  const wonValue = wonOpps.reduce((a, o) => a + Number(o.value), 0);
  const avgTicket = won > 0 ? wonValue / won : 0;

  const cycles = wonOpps
    .map((o) => {
      const end = o.closedAt ?? o.updatedAt;
      return end ? (new Date(end).getTime() - new Date(o.createdAt).getTime()) / DAY : null;
    })
    .filter((d): d is number => d !== null && d >= 0);
  const avgCycleDays = cycles.length ? Math.round(cycles.reduce((a, d) => a + d, 0) / cycles.length) : null;

  const winRate = won + lost > 0 ? won / (won + lost) : 0;

  const lossReasons = lossGroups
    .map((g) => ({ reason: (g.outcomeReason ?? "").trim() || "—", count: g._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const byStage = new Map(openGroups.map((g) => [g.stageId, { count: g._count._all, value: Number(g._sum.value ?? 0) }]));
  const funnel = stages.map((s) => {
    const d = byStage.get(s.id) ?? { count: 0, value: 0 };
    return { id: s.id, name: s.name, count: d.count, value: d.value };
  });

  return { won, lost, canceled, winRate, wonValue, avgTicket, avgCycleDays, lossReasons, funnel };
}
