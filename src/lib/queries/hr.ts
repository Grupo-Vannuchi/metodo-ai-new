import "server-only";
import type { EmployeeStatus, ContractType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
// The filter list lives in validations (client-safe) — the toolbar imports it.
import type { EmployeeStatusFilter } from "@/lib/validations/employee";

export type EmployeeRow = {
  id: string;
  name: string;
  email: string | null;
  status: EmployeeStatus;
  contractType: ContractType;
  jobRoleName: string | null;
  departmentName: string | null;
  hiredAt: Date;
  baseSalary: number;
  hasUser: boolean;
};

/** Employee list for the index, filtered by status / department / search. */
export async function listEmployees(
  organizationId: string,
  opts: { status?: EmployeeStatusFilter; departmentId?: string; q?: string } = {},
): Promise<EmployeeRow[]> {
  const db = tenantDb(organizationId);
  const term = opts.q?.trim();
  const rows = await db.employee.findMany({
    where: {
      ...(opts.status && opts.status !== "ALL" ? { status: opts.status } : {}),
      ...(opts.departmentId ? { departmentId: opts.departmentId } : {}),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" as const } },
              { email: { contains: term, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: 300,
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      contractType: true,
      hiredAt: true,
      baseSalary: true,
      userId: true,
      jobRole: { select: { name: true } },
      department: { select: { name: true } },
    },
  });
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    email: e.email,
    status: e.status,
    contractType: e.contractType,
    jobRoleName: e.jobRole?.name ?? null,
    departmentName: e.department?.name ?? null,
    hiredAt: e.hiredAt,
    baseSalary: Number(e.baseSalary),
    hasUser: e.userId != null,
  }));
}

/** A full employee record for the detail/edit screens (org-scoped). */
export async function getEmployee(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  const e = await db.employee.findFirst({
    where: { id },
    include: {
      jobRole: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  });
  if (!e) return null;

  // Resolve the linked system user's name (ids only on the record, like the
  // other modules — names are resolved at read time).
  const user = e.userId
    ? await prisma.user.findUnique({ where: { id: e.userId }, select: { name: true, email: true } })
    : null;

  return {
    ...e,
    baseSalary: Number(e.baseSalary),
    userName: user?.name ?? null,
    userEmail: user?.email ?? null,
  };
}

/** Documents on an employee's record (metadata only; bytes live in storage). */
export async function listEmployeeDocuments(organizationId: string, employeeId: string) {
  const db = tenantDb(organizationId);
  return db.employeeDocument.findMany({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, mime: true, size: true, url: true, expiresAt: true, createdAt: true },
  });
}

export type CatalogRow = { id: string; name: string; employeeCount: number };

/** Departments with headcount (for the catalog screen). */
export async function listDepartments(organizationId: string): Promise<CatalogRow[]> {
  const db = tenantDb(organizationId);
  const rows = await db.department.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: { id: true, name: true, _count: { select: { employees: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, employeeCount: r._count.employees }));
}

/** Job roles with headcount (for the catalog screen). */
export async function listJobRoles(organizationId: string): Promise<CatalogRow[]> {
  const db = tenantDb(organizationId);
  const rows = await db.jobRole.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: { id: true, name: true, _count: { select: { employees: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, employeeCount: r._count.employees }));
}

export type EmployeeFormOptions = {
  departments: { id: string; name: string }[];
  jobRoles: { id: string; name: string }[];
  /** Org members that can be linked to an employee (id + name). */
  users: { id: string; name: string; email: string }[];
};

/** Option lists for the employee form (catalogs + linkable system users). */
export async function employeeFormOptions(organizationId: string): Promise<EmployeeFormOptions> {
  const db = tenantDb(organizationId);
  const [departments, jobRoles, memberships] = await Promise.all([
    db.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.jobRole.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.membership.findMany({
      where: { organizationId },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  return {
    departments,
    jobRoles,
    users: memberships.map((m) => m.user).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export type HrDashboard = {
  headcount: number;
  onLeave: number;
  terminated: number;
  /** Monthly base-salary cost of the active workforce. */
  monthlyCost: number;
  hiredThisMonth: number;
  birthdays: { id: string; name: string; day: number }[];
  probationEnding: { id: string; name: string; date: Date }[];
  expiringDocs: { id: string; employeeId: string; employeeName: string; name: string; expiresAt: Date }[];
};

/** Headline numbers + the alerts that make the HR screen actionable. */
export async function hrDashboard(organizationId: string): Promise<HrDashboard> {
  const db = tenantDb(organizationId);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const in30Days = new Date(now.getTime() + 30 * 86_400_000);

  const [active, onLeave, terminated, hiredThisMonth, probation, docs] = await Promise.all([
    db.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, birthDate: true, baseSalary: true } }),
    db.employee.count({ where: { status: "ON_LEAVE" } }),
    db.employee.count({ where: { status: "TERMINATED" } }),
    db.employee.count({ where: { hiredAt: { gte: monthStart } } }),
    db.employee.findMany({
      where: { status: "ACTIVE", probationEndsAt: { gte: now, lte: in30Days } },
      orderBy: { probationEndsAt: "asc" },
      take: 10,
      select: { id: true, name: true, probationEndsAt: true },
    }),
    db.employeeDocument.findMany({
      where: { expiresAt: { gte: now, lte: in30Days } },
      orderBy: { expiresAt: "asc" },
      take: 10,
      select: { id: true, name: true, expiresAt: true, employee: { select: { id: true, name: true } } },
    }),
  ]);

  const month = now.getMonth();
  const birthdays = active
    .filter((e) => e.birthDate && new Date(e.birthDate).getMonth() === month)
    .map((e) => ({ id: e.id, name: e.name, day: new Date(e.birthDate!).getDate() }))
    .sort((a, b) => a.day - b.day);

  return {
    headcount: active.length,
    onLeave,
    terminated,
    monthlyCost: active.reduce((s, e) => s + Number(e.baseSalary), 0),
    hiredThisMonth,
    birthdays,
    probationEnding: probation.map((p) => ({ id: p.id, name: p.name, date: p.probationEndsAt! })),
    expiringDocs: docs.map((d) => ({
      id: d.id,
      employeeId: d.employee.id,
      employeeName: d.employee.name,
      name: d.name,
      expiresAt: d.expiresAt!,
    })),
  };
}
