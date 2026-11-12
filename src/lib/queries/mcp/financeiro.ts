import "server-only";
import type { FinanceStatus, FinanceType, Prisma } from "@prisma/client";
import { bucketByCategory, money, utcDayStart, type FinanceGroupRow, type Period } from "@/lib/mcp/core";
import { tenantDb } from "@/lib/tenant-db";

/**
 * Finance reads of the MCP server. Salaries never leave one by one: an entry
 * tied to an employee or to a payroll run is payroll, hidden from the entry
 * list and summed into the single "Folha de pagamento" line of the summary
 * (whose totals still include it, matching the Finance screen).
 */
export const PAYROLL: Prisma.FinanceEntryWhereInput = {
  OR: [{ employeeId: { not: null } }, { payrollRunId: { not: null } }],
};
export const NOT_PAYROLL: Prisma.FinanceEntryWhereInput = { employeeId: null, payrollRunId: null };

type Page = { take: number; skip: number };
type Range = { gte?: Date; lt?: Date } | null;

export async function searchEntries(
  organizationId: string,
  a: {
    type?: FinanceType;
    status?: FinanceStatus;
    categoryName?: string;
    search?: string;
    range: Range;
    page: Page;
  },
) {
  const db = tenantDb(organizationId);
  const where: Prisma.FinanceEntryWhereInput = {
    ...NOT_PAYROLL,
    type: a.type,
    status: a.status,
    ...(a.categoryName ? { category: { name: { equals: a.categoryName, mode: "insensitive" } } } : {}),
    ...(a.search ? { description: { contains: a.search, mode: "insensitive" } } : {}),
    ...(a.range ? { dueDate: a.range } : {}),
  };
  const [total, entries] = await Promise.all([
    db.financeEntry.count({ where }),
    db.financeEntry.findMany({
      where,
      orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
      ...a.page,
      select: {
        id: true,
        type: true,
        description: true,
        amount: true,
        status: true,
        dueDate: true,
        settledAt: true,
        method: true,
        contactId: true,
        companyId: true,
        opportunityId: true,
        installmentNo: true,
        installmentTotal: true,
        category: { select: { name: true } },
      },
    }),
  ]);

  // CRM links are bare ids on FinanceEntry; names resolved like listFinanceEntries does.
  const ids = (pick: (e: (typeof entries)[number]) => string | null) =>
    [...new Set(entries.map(pick).filter((id): id is string => Boolean(id)))];
  const contactIds = ids((e) => e.contactId);
  const companyIds = ids((e) => e.companyId);
  const opportunityIds = ids((e) => e.opportunityId);
  const [contacts, companies, opportunities] = await Promise.all([
    contactIds.length
      ? db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    companyIds.length
      ? db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    opportunityIds.length
      ? db.opportunity.findMany({ where: { id: { in: opportunityIds } }, select: { id: true, title: true } })
      : Promise.resolve([]),
  ]);
  const contactName = new Map(contacts.map((c) => [c.id, c.name]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const opportunityTitle = new Map(opportunities.map((o) => [o.id, o.title]));

  return {
    total,
    items: entries.map((e) => ({
      id: e.id,
      type: e.type,
      description: e.description,
      amount: money(e.amount),
      status: e.status,
      dueDate: e.dueDate,
      settledAt: e.settledAt,
      method: e.method,
      categoryName: e.category?.name ?? null,
      contactName: e.contactId ? (contactName.get(e.contactId) ?? null) : null,
      companyName: e.companyId ? (companyName.get(e.companyId) ?? null) : null,
      opportunityTitle: e.opportunityId ? (opportunityTitle.get(e.opportunityId) ?? null) : null,
      installmentNo: e.installmentNo,
      installmentTotal: e.installmentTotal,
    })),
  };
}

const toCents = (v: Prisma.Decimal | null | undefined) => Math.round(Number(v ?? 0) * 100);
const fromCents = (c: number) => money(c / 100);

type TypeSums = { type: FinanceType; _sum: { amount: Prisma.Decimal | null } }[];
const centsOf = (groups: TypeSums, type: FinanceType) =>
  toCents(groups.find((g) => g.type === type)?._sum.amount);

/**
 * The Finance screen's numbers for a period: accrual (DRE: due in the period,
 * any status), cash (settled in the period), what is open overall (the
 * "A receber / A pagar" cards) and within the period, what is overdue today
 * (any period) and the all-time realized balance.
 */
export async function financeSummary(organizationId: string, period: Period, now: Date) {
  const db = tenantDb(organizationId);
  const inPeriod = { gte: period.gte, lt: period.lt };
  const due: Prisma.FinanceEntryWhereInput = { dueDate: inPeriod };
  const settled: Prisma.FinanceEntryWhereInput = { status: "SETTLED", settledAt: inPeriod };
  const pending: Prisma.FinanceEntryWhereInput = { status: "PENDING", dueDate: inPeriod };
  const overdue: Prisma.FinanceEntryWhereInput = { status: "PENDING", dueDate: { lt: utcDayStart(now) } };
  const payrollExpense: Prisma.FinanceEntryWhereInput = { ...PAYROLL, type: "EXPENSE" };

  const [
    byCategory,
    payrollByType,
    settledByType,
    payrollPaid,
    pendingByType,
    payrollPending,
    overdueByType,
    realized,
    openByType,
  ] = await Promise.all([
      db.financeEntry.groupBy({ by: ["type", "categoryId"], where: { ...due, ...NOT_PAYROLL }, _sum: { amount: true } }),
      db.financeEntry.groupBy({ by: ["type"], where: { ...due, ...PAYROLL }, _sum: { amount: true } }),
      db.financeEntry.groupBy({ by: ["type"], where: settled, _sum: { amount: true } }),
      db.financeEntry.aggregate({ where: { ...settled, ...payrollExpense }, _sum: { amount: true } }),
      db.financeEntry.groupBy({ by: ["type"], where: pending, _sum: { amount: true } }),
      db.financeEntry.aggregate({ where: { ...pending, ...payrollExpense }, _sum: { amount: true } }),
      db.financeEntry.groupBy({ by: ["type"], where: overdue, _sum: { amount: true }, _count: { _all: true } }),
      db.financeEntry.groupBy({ by: ["type"], where: { status: "SETTLED" }, _sum: { amount: true } }),
      // Every open entry, whatever its due date — same as getFinanceSummary's receivable/payable.
      db.financeEntry.groupBy({ by: ["type"], where: { status: "PENDING" }, _sum: { amount: true } }),
    ]);

  const categoryIds = [...new Set(byCategory.map((g) => g.categoryId).filter((id): id is string => Boolean(id)))];
  const categories = categoryIds.length
    ? await db.financeCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
    : [];
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const rows: FinanceGroupRow[] = [
    ...byCategory.map((g) => ({
      type: g.type,
      categoryName: g.categoryId ? (categoryName.get(g.categoryId) ?? null) : null,
      payroll: false,
      total: Number(g._sum.amount ?? 0),
    })),
    ...payrollByType.map((g) => ({ type: g.type, categoryName: null, payroll: true, total: Number(g._sum.amount ?? 0) })),
  ];

  const received = centsOf(settledByType, "INCOME");
  const paid = centsOf(settledByType, "EXPENSE");
  const overdueOf = (type: FinanceType) => {
    const g = overdueByType.find((o) => o.type === type);
    return { count: g?._count._all ?? 0, total: fromCents(toCents(g?._sum.amount)) };
  };

  return {
    period: { from: period.from, to: period.to },
    competencia: bucketByCategory(rows),
    caixa: {
      received: fromCents(received),
      paid: fromCents(paid),
      result: fromCents(received - paid),
      payrollPaid: fromCents(toCents(payrollPaid._sum.amount)),
    },
    emAberto: {
      receivable: fromCents(centsOf(openByType, "INCOME")),
      payable: fromCents(centsOf(openByType, "EXPENSE")),
    },
    pendente: {
      receivable: fromCents(centsOf(pendingByType, "INCOME")),
      payable: fromCents(centsOf(pendingByType, "EXPENSE")),
      payrollPayable: fromCents(toCents(payrollPending._sum.amount)),
    },
    vencidos: { receivable: overdueOf("INCOME"), payable: overdueOf("EXPENSE") },
    saldoRealizado: fromCents(centsOf(realized, "INCOME") - centsOf(realized, "EXPENSE")),
    observacao:
      'Lançamentos de folha entram somados na linha "Folha de pagamento"; não há valores por pessoa.',
  };
}
