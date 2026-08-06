import "server-only";
import { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";

const dec = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));

export type MaintenanceEventRow = {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string | null;
  type: string;
  status: string;
  dueDate: Date;
  performedAt: Date | null;
  provider: string | null;
  cost: number | null;
  certificate: string | null;
  result: string | null;
  overdue: boolean;
};

/** List maintenance/calibration events, urgency-ordered (overdue → upcoming → done). */
export async function listMaintenanceEvents(
  organizationId: string,
  opts?: { type?: string; status?: string },
): Promise<MaintenanceEventRow[]> {
  const db = tenantDb(organizationId);
  const where: Prisma.MaintenanceEventWhereInput = {};
  if (opts?.type === "MAINTENANCE" || opts?.type === "CALIBRATION") where.type = opts.type;
  if (opts?.status === "SCHEDULED" || opts?.status === "DONE" || opts?.status === "CANCELED") where.status = opts.status;

  const events = await db.maintenanceEvent.findMany({ where, orderBy: { dueDate: "desc" }, take: 500 });

  const assetIds = [...new Set(events.map((e) => e.assetId))];
  const assets = assetIds.length
    ? await db.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true, code: true } })
    : [];
  const assetOf = new Map(assets.map((a) => [a.id, a]));

  const now = Date.now();
  const rows: MaintenanceEventRow[] = events.map((e) => {
    const a = assetOf.get(e.assetId);
    return {
      id: e.id,
      assetId: e.assetId,
      assetName: a?.name ?? "—",
      assetCode: a?.code ?? null,
      type: e.type,
      status: e.status,
      dueDate: e.dueDate,
      performedAt: e.performedAt,
      provider: e.provider,
      cost: dec(e.cost),
      certificate: e.certificate,
      result: e.result,
      overdue: e.status === "SCHEDULED" && e.dueDate.getTime() < now,
    };
  });

  const rank = (r: MaintenanceEventRow) => (r.overdue ? 0 : r.status === "SCHEDULED" ? 1 : 2);
  rows.sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    // Scheduled: soonest first; done/canceled: most recent first.
    return rank(a) < 2 ? a.dueDate.getTime() - b.dueDate.getTime() : b.dueDate.getTime() - a.dueDate.getTime();
  });
  return rows;
}

/** Count of overdue scheduled events (for a badge). */
export async function countOverdueMaintenance(organizationId: string): Promise<number> {
  return tenantDb(organizationId).maintenanceEvent.count({
    where: { status: "SCHEDULED", dueDate: { lt: new Date() } },
  });
}

/** Assets as options for the scheduling form. */
export async function maintenanceFormOptions(organizationId: string) {
  const assets = await tenantDb(organizationId).asset.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
    take: 2000,
  });
  return {
    assets: assets.map((a) => ({ id: a.id, label: a.code ? `${a.code} · ${a.name}` : a.name })),
  };
}

export type MaintenanceFormOptions = Awaited<ReturnType<typeof maintenanceFormOptions>>;
