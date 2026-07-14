"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import {
  payrollRunSchema,
  payrollLinesSchema,
  type PayrollRunInput,
  type PayrollLineInput,
} from "@/lib/validations/payroll";

export type PayrollActionResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "duplicate" | "locked" | "no_employees" | "unknown" };

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Sum a payslip's lines into its three totals. */
function itemTotals(lines: { type: string; amount: number }[]) {
  const totalEarnings = money(
    lines.filter((l) => l.type === "EARNING").reduce((s, l) => s + l.amount, 0),
  );
  const totalDeductions = money(
    lines.filter((l) => l.type === "DEDUCTION").reduce((s, l) => s + l.amount, 0),
  );
  return { totalEarnings, totalDeductions, netPay: money(totalEarnings - totalDeductions) };
}

/** Recompute a run's totals from its items. Called after any line edit. */
async function refreshRunTotals(organizationId: string, runId: string) {
  const items = await prisma.payrollItem.findMany({
    where: { payrollRunId: runId, organizationId },
    select: { totalEarnings: true, totalDeductions: true, netPay: true },
  });
  await prisma.payrollRun.updateMany({
    where: { id: runId, organizationId },
    data: {
      totalEarnings: money(items.reduce((s, i) => s + Number(i.totalEarnings), 0)),
      totalDeductions: money(items.reduce((s, i) => s + Number(i.totalDeductions), 0)),
      totalNet: money(items.reduce((s, i) => s + Number(i.netPay), 0)),
    },
  });
}

/**
 * Open a new payroll for a month. Seeds one payslip per ACTIVE employee, each
 * starting with a "Salário base" earning taken from their contract — the user
 * then adds bonuses/deductions on top.
 */
export async function createPayrollRun(input: PayrollRunInput): Promise<PayrollActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = payrollRunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const db = tenantDb(org);
    const { year, month } = parsed.data;

    const existing = await db.payrollRun.findFirst({ where: { year, month }, select: { id: true } });
    if (existing) return { ok: false, error: "duplicate" };

    const employees = await db.employee.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, baseSalary: true, jobRole: { select: { name: true } } },
    });
    if (employees.length === 0) return { ok: false, error: "no_employees" };

    // Validate the category belongs to this org (and is an expense one).
    const categoryId = parsed.data.categoryId
      ? (
          await db.financeCategory.findFirst({
            where: { id: parsed.data.categoryId, type: "EXPENSE" },
            select: { id: true },
          })
        )?.id ?? null
      : null;

    const seeded = employees.map((e) => {
      const base = money(Number(e.baseSalary));
      return { employee: e, base, totals: itemTotals([{ type: "EARNING", amount: base }]) };
    });

    const run = await prisma.payrollRun.create({
      data: {
        organizationId: org,
        year,
        month,
        payDate: new Date(parsed.data.payDate),
        categoryId,
        notes: parsed.data.notes || null,
        createdById: ctx.userId,
        totalEarnings: money(seeded.reduce((s, x) => s + x.totals.totalEarnings, 0)),
        totalDeductions: 0,
        totalNet: money(seeded.reduce((s, x) => s + x.totals.netPay, 0)),
        items: {
          create: seeded.map((x) => ({
            organizationId: org,
            employeeId: x.employee.id,
            employeeName: x.employee.name,
            jobRoleName: x.employee.jobRole?.name ?? null,
            baseSalary: x.base,
            totalEarnings: x.totals.totalEarnings,
            totalDeductions: x.totals.totalDeductions,
            netPay: x.totals.netPay,
            lines: {
              create: [
                { organizationId: org, type: "EARNING" as const, label: "Salário base", amount: x.base, order: 0 },
              ],
            },
          })),
        },
      },
      select: { id: true },
    });

    revalidatePath("/app/hr/payroll");
    return { ok: true, id: run.id };
  } catch (error) {
    console.error("Failed to create payroll run", error);
    return { ok: false, error: "unknown" };
  }
}

/** Replace a payslip's lines (only while the run is a DRAFT) and recompute. */
export async function updatePayrollItemLines(
  itemId: string,
  lines: PayrollLineInput[],
): Promise<PayrollActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = payrollLinesSchema.safeParse(lines);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const db = tenantDb(org);
    const item = await db.payrollItem.findFirst({
      where: { id: itemId },
      select: { id: true, payrollRunId: true, run: { select: { status: true } } },
    });
    if (!item) return { ok: false, error: "unknown" };
    if (item.run.status !== "DRAFT") return { ok: false, error: "locked" };

    const clean = parsed.data.map((l, i) => ({
      organizationId: org,
      payrollItemId: itemId,
      type: l.type,
      label: l.label.trim(),
      amount: money(l.amount),
      order: i,
    }));
    const totals = itemTotals(clean);

    await prisma.$transaction([
      prisma.payrollLine.deleteMany({ where: { payrollItemId: itemId, organizationId: org } }),
      prisma.payrollLine.createMany({ data: clean }),
      prisma.payrollItem.updateMany({ where: { id: itemId, organizationId: org }, data: totals }),
    ]);
    await refreshRunTotals(org, item.payrollRunId);

    revalidatePath(`/app/hr/payroll/${item.payrollRunId}`);
    return { ok: true, id: itemId };
  } catch (error) {
    console.error("Failed to update payroll lines", error);
    return { ok: false, error: "unknown" };
  }
}

/** DRAFT → APPROVED (closes the run for editing). */
export async function approvePayrollRun(id: string): Promise<PayrollActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  try {
    const db = tenantDb(ctx.organizationId);
    const run = await db.payrollRun.findFirst({ where: { id }, select: { status: true } });
    if (!run) return { ok: false, error: "unknown" };
    if (run.status !== "DRAFT") return { ok: false, error: "locked" };

    await db.payrollRun.updateMany({
      where: { id },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
    revalidatePath("/app/hr/payroll");
    revalidatePath(`/app/hr/payroll/${id}`);
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to approve payroll run", error);
    return { ok: false, error: "unknown" };
  }
}

/** APPROVED → DRAFT (reopen for edits; a PAID run can never be reopened). */
export async function reopenPayrollRun(id: string): Promise<PayrollActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  try {
    const db = tenantDb(ctx.organizationId);
    const run = await db.payrollRun.findFirst({ where: { id }, select: { status: true } });
    if (!run) return { ok: false, error: "unknown" };
    if (run.status !== "APPROVED") return { ok: false, error: "locked" };

    await db.payrollRun.updateMany({ where: { id }, data: { status: "DRAFT", approvedAt: null } });
    revalidatePath("/app/hr/payroll");
    revalidatePath(`/app/hr/payroll/${id}`);
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to reopen payroll run", error);
    return { ok: false, error: "unknown" };
  }
}

/**
 * APPROVED → PAID. THE BRIDGE: posts one EXPENSE entry per employee into the
 * finance ledger (settled on the pay date, linked back to the employee and the
 * run), so the folha shows up in Fluxo de Caixa and DRE. Idempotent per item —
 * an item that already carries a financeEntryId is skipped.
 */
export async function payPayrollRun(id: string): Promise<PayrollActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  try {
    const org = ctx.organizationId;
    const db = tenantDb(org);
    const run = await db.payrollRun.findFirst({
      where: { id },
      select: {
        id: true,
        status: true,
        year: true,
        month: true,
        payDate: true,
        categoryId: true,
        items: {
          select: { id: true, employeeId: true, employeeName: true, netPay: true, financeEntryId: true },
        },
      },
    });
    if (!run) return { ok: false, error: "unknown" };
    if (run.status !== "APPROVED") return { ok: false, error: "locked" };

    const mm = String(run.month).padStart(2, "0");
    const pending = run.items.filter((it) => !it.financeEntryId && Number(it.netPay) > 0);

    await prisma.$transaction(async (tx) => {
      for (const item of pending) {
        const entry = await tx.financeEntry.create({
          data: {
            organizationId: org,
            type: "EXPENSE",
            description: `Folha ${mm}/${run.year} — ${item.employeeName}`,
            amount: money(Number(item.netPay)),
            status: "SETTLED",
            dueDate: run.payDate,
            settledAt: run.payDate,
            categoryId: run.categoryId,
            employeeId: item.employeeId,
            payrollRunId: run.id,
            createdById: ctx.userId,
          },
          select: { id: true },
        });
        await tx.payrollItem.update({
          where: { id: item.id },
          data: { financeEntryId: entry.id },
        });
      }
      await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: "PAID", paidAt: new Date() },
      });
    });

    revalidatePath("/app/hr/payroll");
    revalidatePath(`/app/hr/payroll/${id}`);
    revalidatePath("/app/finance");
    revalidatePath("/app/finance/entries");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to pay payroll run", error);
    return { ok: false, error: "unknown" };
  }
}

/** Delete a run. A PAID run is immutable (its entries are already in the ledger). */
export async function deletePayrollRun(id: string): Promise<{ ok: boolean; error?: "locked" }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    const run = await db.payrollRun.findFirst({ where: { id }, select: { status: true } });
    if (!run) return { ok: false };
    if (run.status === "PAID") return { ok: false, error: "locked" };

    await db.payrollRun.deleteMany({ where: { id } });
    revalidatePath("/app/hr/payroll");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete payroll run", error);
    return { ok: false };
  }
}
