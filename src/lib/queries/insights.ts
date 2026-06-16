import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type StageInsight = {
  id: string;
  name: string;
  probability: number;
  count: number;
  value: number;
};

export type DashboardInsights = {
  pipeline: {
    openCount: number;
    openValue: number;
    /** Σ value × stage.probability — the forecast. */
    weightedValue: number;
    wonCount: number;
    wonValue: number;
    lostCount: number;
  };
  stages: StageInsight[];
  crm: { companies: number; contacts: number };
  campaigns: { sentMonth: number };
};

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Aggregated KPIs for the dashboard. All reads scoped to the org. */
export async function getDashboardInsights(
  organizationId: string,
): Promise<DashboardInsights> {
  const db = tenantDb(organizationId);
  const monthStart = startOfMonth();

  const pipeline =
    (await db.pipeline.findFirst({ where: { isDefault: true }, orderBy: { order: "asc" } })) ??
    (await db.pipeline.findFirst({ orderBy: { order: "asc" } }));

  const stages = pipeline
    ? await db.stage.findMany({
        where: { pipelineId: pipeline.id },
        orderBy: { order: "asc" },
        select: { id: true, name: true, probability: true },
      })
    : [];

  const grouped = pipeline
    ? await db.opportunity.groupBy({
        by: ["stageId"],
        where: { pipelineId: pipeline.id, status: "OPEN" },
        _count: { _all: true },
        _sum: { value: true },
      })
    : [];
  const byStage = new Map(
    grouped.map((g) => [g.stageId, { count: g._count._all, value: Number(g._sum.value ?? 0) }]),
  );

  const stageRows: StageInsight[] = stages.map((s) => {
    const d = byStage.get(s.id) ?? { count: 0, value: 0 };
    return { id: s.id, name: s.name, probability: s.probability, count: d.count, value: d.value };
  });

  const openCount = stageRows.reduce((a, s) => a + s.count, 0);
  const openValue = stageRows.reduce((a, s) => a + s.value, 0);
  const weightedValue = stageRows.reduce((a, s) => a + s.value * (s.probability / 100), 0);

  const [wonAgg, lostCount, companies, contacts, sentMonth] = await Promise.all([
    db.opportunity.aggregate({
      where: { status: "WON", updatedAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { value: true },
    }),
    db.opportunity.count({ where: { status: "LOST", updatedAt: { gte: monthStart } } }),
    db.company.count(),
    db.contact.count(),
    db.campaignRecipient.count({
      where: { status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: monthStart } },
    }),
  ]);

  return {
    pipeline: {
      openCount,
      openValue,
      weightedValue,
      wonCount: wonAgg._count._all,
      wonValue: Number(wonAgg._sum.value ?? 0),
      lostCount,
    },
    stages: stageRows,
    crm: { companies, contacts },
    campaigns: { sentMonth },
  };
}
