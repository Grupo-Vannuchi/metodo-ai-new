import "server-only";
import type { EmployeeStatus, Prisma } from "@prisma/client";
import { utcDayStart, type Period } from "@/lib/mcp/core";
import { tenantDb } from "@/lib/tenant-db";

/**
 * HR reads of the MCP server: who works where and counts — never salary,
 * payroll, bank or PIX data, documents, address, birth date, contact data, the
 * reason someone left, or the reason/note of a time off (it can be health data).
 */

type Page = { take: number; skip: number };

const DAY_MS = 86_400_000;
const NO_DEPARTMENT = "Sem departamento";

export async function searchEmployees(
  organizationId: string,
  a: { status?: EmployeeStatus; departmentId?: string; search?: string; page: Page },
) {
  const db = tenantDb(organizationId);
  const where: Prisma.EmployeeWhereInput = {
    status: a.status,
    departmentId: a.departmentId,
    ...(a.search ? { name: { contains: a.search, mode: "insensitive" } } : {}),
  };
  const [total, rows] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      orderBy: { name: "asc" },
      ...a.page,
      select: {
        id: true,
        name: true,
        status: true,
        hiredAt: true,
        terminatedAt: true,
        jobRole: { select: { name: true } },
        department: { select: { name: true } },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((e) => ({
      id: e.id,
      name: e.name,
      jobRoleName: e.jobRole?.name ?? null,
      departmentName: e.department?.name ?? null,
      status: e.status,
      hiredAt: e.hiredAt,
      terminatedAt: e.terminatedAt,
    })),
  };
}

/** Headcount, hires/exits and time off of a period — counts only, no names. */
export async function hrSummary(organizationId: string, period: Period, now: Date) {
  const db = tenantDb(organizationId);
  const inPeriod = { gte: period.gte, lt: period.lt };
  const today = utcDayStart(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);

  const [byStatus, activeByDepartment, hires, terminations, pendingTimeOff, approvedByType, awayToday] =
    await Promise.all([
      db.employee.groupBy({ by: ["status"], _count: { _all: true } }),
      db.employee.groupBy({ by: ["departmentId"], where: { status: "ACTIVE" }, _count: { _all: true } }),
      db.employee.count({ where: { hiredAt: inPeriod } }),
      db.employee.count({ where: { terminatedAt: inPeriod } }),
      db.timeOff.count({ where: { status: "PENDING" } }),
      db.timeOff.groupBy({
        by: ["type"],
        where: { status: "APPROVED", startDate: inPeriod },
        _count: { _all: true },
        _sum: { days: true },
      }),
      // endDate is the last day off (inclusive), stored as that day's midnight.
      db.timeOff.count({ where: { status: "APPROVED", startDate: { lt: tomorrow }, endDate: { gte: today } } }),
    ]);

  const departmentIds = activeByDepartment
    .map((g) => g.departmentId)
    .filter((id): id is string => Boolean(id));
  const departments = departmentIds.length
    ? await db.department.findMany({ where: { id: { in: departmentIds } }, select: { id: true, name: true } })
    : [];
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  const countOf = (status: EmployeeStatus) => byStatus.find((g) => g.status === status)?._count._all ?? 0;

  return {
    period: { from: period.from, to: period.to },
    headcount: { active: countOf("ACTIVE"), onLeave: countOf("ON_LEAVE"), terminated: countOf("TERMINATED") },
    byDepartment: activeByDepartment
      .map((g) => ({
        departmentName: g.departmentId ? (departmentName.get(g.departmentId) ?? NO_DEPARTMENT) : NO_DEPARTMENT,
        active: g._count._all,
      }))
      .sort((x, y) => y.active - x.active),
    hires,
    terminations,
    timeOff: {
      pending: pendingTimeOff,
      approvedInPeriod: approvedByType.map((g) => ({
        type: g.type,
        count: g._count._all,
        days: g._sum.days ?? 0,
      })),
    },
    awayToday,
  };
}
