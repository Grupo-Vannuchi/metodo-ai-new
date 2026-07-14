import "server-only";
import type { PayrollStatus, PayrollLineType } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";

export type PayrollRunRow = {
  id: string;
  year: number;
  month: number;
  status: PayrollStatus;
  payDate: Date;
  totalNet: number;
  employeeCount: number;
};

/** Payroll runs for the index, newest competência first. */
export async function listPayrollRuns(organizationId: string): Promise<PayrollRunRow[]> {
  const db = tenantDb(organizationId);
  const rows = await db.payrollRun.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 60,
    select: {
      id: true,
      year: true,
      month: true,
      status: true,
      payDate: true,
      totalNet: true,
      _count: { select: { items: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    year: r.year,
    month: r.month,
    status: r.status,
    payDate: r.payDate,
    totalNet: Number(r.totalNet),
    employeeCount: r._count.items,
  }));
}

export type PayrollLineRow = { id: string; type: PayrollLineType; label: string; amount: number };

export type PayrollItemRow = {
  id: string;
  employeeId: string | null;
  employeeName: string;
  jobRoleName: string | null;
  baseSalary: number;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  financeEntryId: string | null;
  lines: PayrollLineRow[];
};

export type PayrollRunDetail = {
  id: string;
  year: number;
  month: number;
  status: PayrollStatus;
  payDate: Date;
  categoryId: string | null;
  categoryName: string | null;
  notes: string | null;
  totalEarnings: number;
  totalDeductions: number;
  totalNet: number;
  paidAt: Date | null;
  items: PayrollItemRow[];
};

/** A full payroll run with every payslip and its lines (org-scoped). */
export async function getPayrollRun(
  organizationId: string,
  id: string,
): Promise<PayrollRunDetail | null> {
  const db = tenantDb(organizationId);
  const run = await db.payrollRun.findFirst({
    where: { id },
    include: {
      items: {
        orderBy: { employeeName: "asc" },
        include: { lines: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!run) return null;

  const category = run.categoryId
    ? await db.financeCategory.findFirst({ where: { id: run.categoryId }, select: { name: true } })
    : null;

  return {
    id: run.id,
    year: run.year,
    month: run.month,
    status: run.status,
    payDate: run.payDate,
    categoryId: run.categoryId,
    categoryName: category?.name ?? null,
    notes: run.notes,
    totalEarnings: Number(run.totalEarnings),
    totalDeductions: Number(run.totalDeductions),
    totalNet: Number(run.totalNet),
    paidAt: run.paidAt,
    items: run.items.map((it) => ({
      id: it.id,
      employeeId: it.employeeId,
      employeeName: it.employeeName,
      jobRoleName: it.jobRoleName,
      baseSalary: Number(it.baseSalary),
      totalEarnings: Number(it.totalEarnings),
      totalDeductions: Number(it.totalDeductions),
      netPay: Number(it.netPay),
      financeEntryId: it.financeEntryId,
      lines: it.lines.map((l) => ({
        id: l.id,
        type: l.type,
        label: l.label,
        amount: Number(l.amount),
      })),
    })),
  };
}

/** One payslip (item) with everything the printed document needs. */
export async function getPayslip(organizationId: string, itemId: string) {
  const db = tenantDb(organizationId);
  const item = await db.payrollItem.findFirst({
    where: { id: itemId },
    include: {
      lines: { orderBy: { order: "asc" } },
      run: { select: { year: true, month: true, payDate: true, status: true } },
      employee: { select: { document: true, documentType: true, bankName: true, pixKey: true } },
    },
  });
  if (!item) return null;

  return {
    id: item.id,
    employeeName: item.employeeName,
    jobRoleName: item.jobRoleName,
    baseSalary: Number(item.baseSalary),
    totalEarnings: Number(item.totalEarnings),
    totalDeductions: Number(item.totalDeductions),
    netPay: Number(item.netPay),
    year: item.run.year,
    month: item.run.month,
    payDate: item.run.payDate,
    document: item.employee?.document ?? null,
    documentType: item.employee?.documentType ?? null,
    bankName: item.employee?.bankName ?? null,
    pixKey: item.employee?.pixKey ?? null,
    lines: item.lines.map((l) => ({ type: l.type, label: l.label, amount: Number(l.amount) })),
  };
}

export type PaymentHistoryRow = {
  itemId: string;
  runId: string;
  year: number;
  month: number;
  status: PayrollStatus;
  netPay: number;
  payDate: Date;
  financeEntryId: string | null;
};

/** An employee's payment history — every payslip they appear in. */
export async function employeePaymentHistory(
  organizationId: string,
  employeeId: string,
): Promise<PaymentHistoryRow[]> {
  const db = tenantDb(organizationId);
  const items = await db.payrollItem.findMany({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
    take: 36,
    select: {
      id: true,
      netPay: true,
      financeEntryId: true,
      run: { select: { id: true, year: true, month: true, status: true, payDate: true } },
    },
  });
  return items.map((it) => ({
    itemId: it.id,
    runId: it.run.id,
    year: it.run.year,
    month: it.run.month,
    status: it.run.status,
    netPay: Number(it.netPay),
    payDate: it.run.payDate,
    financeEntryId: it.financeEntryId,
  }));
}

/** Expense categories, to classify the payroll entries in the DRE. */
export async function expenseCategories(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.financeCategory.findMany({
    where: { type: "EXPENSE" },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}
