import "server-only";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";

/** Pie-chart breakdowns the user can pick on the dashboard. The finance one is
 * only offered when the plan includes finance (see PIE_FINANCE_MODELS). */
export const PIE_MODELS = [
  "opps_by_stage",
  "value_by_stage",
  "opps_by_status",
  "opps_by_owner",
  "contacts_by_source",
  "tasks_by_priority",
] as const;
export const PIE_FINANCE_MODELS = ["finance_by_type"] as const;

export type PieModel = (typeof PIE_MODELS)[number] | (typeof PIE_FINANCE_MODELS)[number];

/** One slice: `key` is either a resolved display name (stage/owner/source) or a
 * raw enum value (status/priority/type) that the route localizes. */
export type PieSlice = { key: string; value: number };

/** Merge slices that share a key (e.g. same-named stages across pipelines),
 * drop empties and sort by value descending — the shape the chart expects. */
function finalize(slices: PieSlice[]): PieSlice[] {
  const merged = new Map<string, number>();
  for (const s of slices) {
    if (s.value > 0) merged.set(s.key, (merged.get(s.key) ?? 0) + s.value);
  }
  return [...merged.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

export async function dashboardPie(organizationId: string, model: PieModel): Promise<PieSlice[]> {
  const db = tenantDb(organizationId);

  switch (model) {
    case "opps_by_stage": {
      const [groups, stages] = await Promise.all([
        db.opportunity.groupBy({ by: ["stageId"], where: { status: "OPEN" }, _count: { _all: true } }),
        db.stage.findMany({ select: { id: true, name: true } }),
      ]);
      const names = new Map(stages.map((s) => [s.id, s.name]));
      return finalize(groups.map((g) => ({ key: names.get(g.stageId) ?? "—", value: g._count._all })));
    }
    case "value_by_stage": {
      const [groups, stages] = await Promise.all([
        db.opportunity.groupBy({ by: ["stageId"], where: { status: "OPEN" }, _sum: { value: true } }),
        db.stage.findMany({ select: { id: true, name: true } }),
      ]);
      const names = new Map(stages.map((s) => [s.id, s.name]));
      return finalize(groups.map((g) => ({ key: names.get(g.stageId) ?? "—", value: Number(g._sum.value ?? 0) })));
    }
    case "opps_by_status": {
      const groups = await db.opportunity.groupBy({ by: ["status"], _count: { _all: true } });
      return finalize(groups.map((g) => ({ key: g.status, value: g._count._all })));
    }
    case "opps_by_owner": {
      const groups = await db.opportunity.groupBy({ by: ["ownerId"], where: { status: "OPEN" }, _count: { _all: true } });
      const ids = groups.map((g) => g.ownerId).filter((x): x is string => Boolean(x));
      const users = ids.length
        ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : [];
      const names = new Map(users.map((u) => [u.id, u.name]));
      return finalize(groups.map((g) => ({ key: g.ownerId ? names.get(g.ownerId) ?? "—" : "__none__", value: g._count._all })));
    }
    case "contacts_by_source": {
      const groups = await db.contact.groupBy({ by: ["source"], _count: { _all: true } });
      return finalize(groups.map((g) => ({ key: g.source || "__none__", value: g._count._all })));
    }
    case "tasks_by_priority": {
      const groups = await db.task.groupBy({ by: ["priority"], where: { doneAt: null }, _count: { _all: true } });
      return finalize(groups.map((g) => ({ key: g.priority, value: g._count._all })));
    }
    case "finance_by_type": {
      const groups = await db.financeEntry.groupBy({ by: ["type"], _sum: { amount: true } });
      return finalize(groups.map((g) => ({ key: g.type, value: Number(g._sum.amount ?? 0) })));
    }
    default:
      return [];
  }
}
