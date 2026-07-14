import "server-only";
import type { TimeOffType, TimeOffStatus } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import type { TimeOffStatusFilter } from "@/lib/validations/time-off";

export type TimeOffRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  type: TimeOffType;
  status: TimeOffStatus;
  startDate: Date;
  endDate: Date;
  days: number;
  reason: string | null;
  decisionNote: string | null;
};

/** Time-off requests for the list screen, newest period first. */
export async function listTimeOff(
  organizationId: string,
  opts: { status?: TimeOffStatusFilter; employeeId?: string } = {},
): Promise<TimeOffRow[]> {
  const db = tenantDb(organizationId);
  const rows = await db.timeOff.findMany({
    where: {
      ...(opts.status && opts.status !== "ALL" ? { status: opts.status } : {}),
      ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
    },
    // Pending first (they need a decision), then by most recent period.
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    take: 200,
    include: { employee: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employee.name,
    type: r.type,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    days: r.days,
    reason: r.reason,
    decisionNote: r.decisionNote,
  }));
}

/** An employee's own time-off history (shown on their record). */
export async function employeeTimeOff(organizationId: string, employeeId: string) {
  const db = tenantDb(organizationId);
  return db.timeOff.findMany({
    where: { employeeId },
    orderBy: { startDate: "desc" },
    take: 30,
    select: {
      id: true,
      type: true,
      status: true,
      startDate: true,
      endDate: true,
      days: true,
      reason: true,
    },
  });
}

/** Who is away today (approved periods covering the current date). */
export async function awayToday(organizationId: string) {
  const db = tenantDb(organizationId);
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const rows = await db.timeOff.findMany({
    where: { status: "APPROVED", startDate: { lte: end }, endDate: { gte: start } },
    orderBy: { endDate: "asc" },
    take: 20,
    select: {
      id: true,
      type: true,
      endDate: true,
      employee: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employee.id,
    employeeName: r.employee.name,
    type: r.type,
    endDate: r.endDate,
  }));
}

export type HrAlertCounts = {
  birthdaysToday: number;
  probationEnding: number;
  docsExpiring: number;
  timeOffPending: number;
};

/**
 * Org-level HR counters for the daily digest. Only the managers (OWNER/ADMIN of
 * an org whose plan includes "hr") receive these — payroll/HR is sensitive.
 */
export async function hrAlertCounts(organizationId: string): Promise<HrAlertCounts> {
  const db = tenantDb(organizationId);
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 86_400_000);

  const [active, probationEnding, docsExpiring, timeOffPending] = await Promise.all([
    db.employee.findMany({ where: { status: "ACTIVE" }, select: { birthDate: true } }),
    db.employee.count({
      where: { status: "ACTIVE", probationEndsAt: { gte: now, lte: in30Days } },
    }),
    db.employeeDocument.count({ where: { expiresAt: { gte: now, lte: in30Days } } }),
    db.timeOff.count({ where: { status: "PENDING" } }),
  ]);

  const birthdaysToday = active.filter((e) => {
    if (!e.birthDate) return false;
    const b = new Date(e.birthDate);
    return b.getMonth() === now.getMonth() && b.getDate() === now.getDate();
  }).length;

  return { birthdaysToday, probationEnding, docsExpiring, timeOffPending };
}
