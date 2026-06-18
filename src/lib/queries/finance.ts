import "server-only";
import { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";

export type EntryType = "INCOME" | "EXPENSE";
export type EntryStatus = "PENDING" | "SETTLED";

const dec = (v: Prisma.Decimal | null | undefined): number => (v ? Number(v) : 0);

function monthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

// ── Overview KPIs ──────────────────────────────────────────────────────────

export type FinanceSummary = {
  receivable: number; // a receber (INCOME pendente)
  payable: number; // a pagar (EXPENSE pendente)
  balance: number; // saldo realizado (recebido − pago, acumulado)
  monthIncome: number; // receita do mês (competência)
  monthExpense: number; // despesa do mês (competência)
  monthResult: number; // resultado do mês
};

export async function getFinanceSummary(organizationId: string): Promise<FinanceSummary> {
  const db = tenantDb(organizationId);
  const { start, end } = monthRange();

  const [recv, pay, sIncome, sExpense, mIncome, mExpense] = await Promise.all([
    db.financeEntry.aggregate({ _sum: { amount: true }, where: { type: "INCOME", status: "PENDING" } }),
    db.financeEntry.aggregate({ _sum: { amount: true }, where: { type: "EXPENSE", status: "PENDING" } }),
    db.financeEntry.aggregate({ _sum: { amount: true }, where: { type: "INCOME", status: "SETTLED" } }),
    db.financeEntry.aggregate({ _sum: { amount: true }, where: { type: "EXPENSE", status: "SETTLED" } }),
    db.financeEntry.aggregate({ _sum: { amount: true }, where: { type: "INCOME", dueDate: { gte: start, lt: end } } }),
    db.financeEntry.aggregate({ _sum: { amount: true }, where: { type: "EXPENSE", dueDate: { gte: start, lt: end } } }),
  ]);

  const monthIncome = dec(mIncome._sum.amount);
  const monthExpense = dec(mExpense._sum.amount);
  return {
    receivable: dec(recv._sum.amount),
    payable: dec(pay._sum.amount),
    balance: dec(sIncome._sum.amount) - dec(sExpense._sum.amount),
    monthIncome,
    monthExpense,
    monthResult: monthIncome - monthExpense,
  };
}

// ── Entries (lançamentos) ────────────────────────────────────────────────────

export type EntryFilter = {
  type?: EntryType;
  status?: EntryStatus;
  from?: Date;
  to?: Date;
};

export type EntryRow = {
  id: string;
  type: EntryType;
  description: string;
  amount: number;
  status: EntryStatus;
  dueDate: Date;
  settledAt: Date | null;
  method: string | null;
  categoryName: string | null;
  contactName: string | null;
  companyName: string | null;
  opportunityTitle: string | null;
};

export async function listFinanceEntries(
  organizationId: string,
  filter: EntryFilter = {},
): Promise<EntryRow[]> {
  const db = tenantDb(organizationId);
  const where: Prisma.FinanceEntryWhereInput = {};
  if (filter.type) where.type = filter.type;
  if (filter.status) where.status = filter.status;
  if (filter.from || filter.to) {
    where.dueDate = { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) };
  }

  const entries = await db.financeEntry.findMany({
    where,
    orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
    take: 500,
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
      category: { select: { name: true } },
    },
  });

  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean))] as string[];
  const contactIds = uniq(entries.map((e) => e.contactId));
  const companyIds = uniq(entries.map((e) => e.companyId));
  const oppIds = uniq(entries.map((e) => e.opportunityId));

  const [contacts, companies, opps] = await Promise.all([
    contactIds.length ? db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } }) : [],
    companyIds.length ? db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
    oppIds.length ? db.opportunity.findMany({ where: { id: { in: oppIds } }, select: { id: true, title: true } }) : [],
  ]);
  const cMap = new Map(contacts.map((c) => [c.id, c.name]));
  const coMap = new Map(companies.map((c) => [c.id, c.name]));
  const oMap = new Map(opps.map((o) => [o.id, o.title]));

  return entries.map((e) => ({
    id: e.id,
    type: e.type,
    description: e.description,
    amount: Number(e.amount),
    status: e.status,
    dueDate: e.dueDate,
    settledAt: e.settledAt,
    method: e.method,
    categoryName: e.category?.name ?? null,
    contactName: e.contactId ? cMap.get(e.contactId) ?? null : null,
    companyName: e.companyId ? coMap.get(e.companyId) ?? null : null,
    opportunityTitle: e.opportunityId ? oMap.get(e.opportunityId) ?? null : null,
  }));
}

export async function getFinanceEntry(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  const e = await db.financeEntry.findFirst({
    where: { id },
    select: {
      id: true,
      type: true,
      description: true,
      amount: true,
      status: true,
      dueDate: true,
      settledAt: true,
      method: true,
      notes: true,
      categoryId: true,
      contactId: true,
      companyId: true,
      opportunityId: true,
    },
  });
  if (!e) return null;
  return { ...e, amount: Number(e.amount) };
}

// ── Form options ─────────────────────────────────────────────────────────────

export async function financeFormOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  const [contacts, companies, opportunities, categories] = await Promise.all([
    db.contact.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 1000 }),
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 1000 }),
    db.opportunity.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true }, take: 1000 }),
    db.financeCategory.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true },
    }),
  ]);
  return { contacts, companies, opportunities, categories };
}

// ── Cash flow (regime de caixa) ──────────────────────────────────────────────

export type CashflowMonth = {
  key: string;
  income: number; // realizado (recebido) no mês
  expense: number; // realizado (pago) no mês
  result: number; // income − expense
  cumulative: number; // saldo acumulado ao fim do mês
  pendingIncome: number; // a receber com vencimento no mês
  pendingExpense: number; // a pagar com vencimento no mês
};

export async function getCashflow(organizationId: string, months = 6): Promise<CashflowMonth[]> {
  const db = tenantDb(organizationId);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [opening, settled, pending] = await Promise.all([
    // realized balance before the window → opening cumulative
    db.financeEntry.groupBy({
      by: ["type"],
      where: { status: "SETTLED", settledAt: { lt: start } },
      _sum: { amount: true },
    }),
    db.financeEntry.findMany({
      where: { status: "SETTLED", settledAt: { gte: start, lt: end } },
      select: { type: true, amount: true, settledAt: true },
    }),
    db.financeEntry.findMany({
      where: { status: "PENDING", dueDate: { gte: start, lt: end } },
      select: { type: true, amount: true, dueDate: true },
    }),
  ]);

  let cumulative = opening.reduce(
    (acc, g) => acc + (g.type === "INCOME" ? dec(g._sum.amount) : -dec(g._sum.amount)),
    0,
  );

  const buckets: CashflowMonth[] = Array.from({ length: months }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      income: 0,
      expense: 0,
      result: 0,
      cumulative: 0,
      pendingIncome: 0,
      pendingExpense: 0,
    };
  });
  const indexOf = (d: Date) =>
    (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());

  for (const e of settled) {
    const idx = e.settledAt ? indexOf(e.settledAt) : -1;
    if (idx < 0 || idx >= buckets.length) continue;
    if (e.type === "INCOME") buckets[idx].income += Number(e.amount);
    else buckets[idx].expense += Number(e.amount);
  }
  for (const e of pending) {
    const idx = indexOf(e.dueDate);
    if (idx < 0 || idx >= buckets.length) continue;
    if (e.type === "INCOME") buckets[idx].pendingIncome += Number(e.amount);
    else buckets[idx].pendingExpense += Number(e.amount);
  }
  for (const b of buckets) {
    b.result = b.income - b.expense;
    cumulative += b.result;
    b.cumulative = cumulative;
  }
  return buckets;
}

// ── DRE (regime de competência) ──────────────────────────────────────────────

export type DreLine = { categoryName: string; total: number };
export type Dre = {
  income: DreLine[];
  expense: DreLine[];
  totalIncome: number;
  totalExpense: number;
  result: number;
};

export async function getDre(organizationId: string, from: Date, to: Date): Promise<Dre> {
  const db = tenantDb(organizationId);
  const grouped = await db.financeEntry.groupBy({
    by: ["type", "categoryId"],
    where: { dueDate: { gte: from, lt: to } },
    _sum: { amount: true },
  });

  const catIds = [...new Set(grouped.map((g) => g.categoryId).filter(Boolean))] as string[];
  const cats = catIds.length
    ? await db.financeCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } })
    : [];
  const catMap = new Map(cats.map((c) => [c.id, c.name]));

  const income: DreLine[] = [];
  const expense: DreLine[] = [];
  for (const g of grouped) {
    const line = { categoryName: g.categoryId ? catMap.get(g.categoryId) ?? "—" : "—", total: dec(g._sum.amount) };
    (g.type === "INCOME" ? income : expense).push(line);
  }
  income.sort((a, b) => b.total - a.total);
  expense.sort((a, b) => b.total - a.total);

  const totalIncome = income.reduce((s, l) => s + l.total, 0);
  const totalExpense = expense.reduce((s, l) => s + l.total, 0);
  return { income, expense, totalIncome, totalExpense, result: totalIncome - totalExpense };
}
