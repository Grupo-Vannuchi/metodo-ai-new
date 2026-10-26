import "server-only";
import type { OpportunityStatus, Prisma, ProposalStatus } from "@prisma/client";
import { money, type Period } from "@/lib/mcp/core";
import { userNames } from "@/lib/queries/mcp/shared";
import { tenantDb } from "@/lib/tenant-db";

/**
 * CRM reads of the MCP server — explicit `select`s only, through
 * `tenantDb(organizationId)`. Free-text notes and proposal bodies never leave.
 */

type Page = { take: number; skip: number };
type Range = { gte?: Date; lt?: Date } | null;

const insensitive = (s: string) => ({ contains: s, mode: "insensitive" as const });

/** `Company.address` is free JSON ({ street, number, district, city, uf, zip }); only city/uf go out. */
function cityAndUf(address: Prisma.JsonValue): { city: string | null; uf: string | null } {
  const a = address && typeof address === "object" && !Array.isArray(address) ? address : {};
  return {
    city: typeof a.city === "string" ? a.city : null,
    uf: typeof a.uf === "string" ? a.uf : null,
  };
}

export async function searchCompanies(organizationId: string, a: { search?: string; page: Page }) {
  const db = tenantDb(organizationId);
  const where: Prisma.CompanyWhereInput = a.search
    ? { OR: [{ name: insensitive(a.search) }, { cnpj: insensitive(a.search) }, { email: insensitive(a.search) }] }
    : {};
  const [total, rows] = await Promise.all([
    db.company.count({ where }),
    db.company.findMany({
      where,
      orderBy: { name: "asc" },
      ...a.page,
      select: {
        id: true,
        name: true,
        cnpj: true,
        email: true,
        phone: true,
        website: true,
        address: true,
        source: true,
        createdAt: true,
        _count: { select: { contacts: true, opportunities: { where: { status: "OPEN" } } } },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((c) => ({
      id: c.id,
      name: c.name,
      cnpj: c.cnpj,
      email: c.email,
      phone: c.phone,
      website: c.website,
      ...cityAndUf(c.address),
      source: c.source,
      createdAt: c.createdAt,
      contactCount: c._count.contacts,
      openOpportunityCount: c._count.opportunities,
    })),
  };
}

export async function searchContacts(
  organizationId: string,
  a: { search?: string; companyId?: string; tag?: string; page: Page },
) {
  const db = tenantDb(organizationId);
  const where: Prisma.ContactWhereInput = {
    companyId: a.companyId,
    ...(a.tag ? { tags: { has: a.tag } } : {}),
    ...(a.search
      ? { OR: [{ name: insensitive(a.search) }, { email: insensitive(a.search) }, { phone: insensitive(a.search) }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      orderBy: { name: "asc" },
      ...a.page,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        tags: true,
        companyId: true,
        source: true,
        optedOut: true,
        createdAt: true,
        company: { select: { name: true } },
      },
    }),
  ]);
  return {
    total,
    items: rows.map(({ company, ...c }) => ({ ...c, companyName: company?.name ?? null })),
  };
}

export type OpportunityDateField = "createdAt" | "closedAt" | "expectedCloseDate";

export async function searchOpportunities(
  organizationId: string,
  a: {
    status?: OpportunityStatus;
    pipelineId?: string;
    stageId?: string;
    ownerId?: string;
    companyId?: string;
    search?: string;
    dateField: OpportunityDateField;
    range: Range;
    page: Page;
  },
) {
  const db = tenantDb(organizationId);
  const where: Prisma.OpportunityWhereInput = {
    status: a.status,
    pipelineId: a.pipelineId,
    stageId: a.stageId,
    ownerId: a.ownerId,
    companyId: a.companyId,
    ...(a.search ? { OR: [{ title: insensitive(a.search) }, { code: insensitive(a.search) }] } : {}),
    ...(a.range ? { [a.dateField]: a.range } : {}),
  };
  const [total, rows] = await Promise.all([
    db.opportunity.count({ where }),
    db.opportunity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...a.page,
      select: {
        id: true,
        code: true,
        title: true,
        value: true,
        status: true,
        ownerId: true,
        expectedCloseDate: true,
        closedAt: true,
        outcomeReason: true,
        createdAt: true,
        pipeline: { select: { name: true } },
        stage: { select: { name: true } },
        company: { select: { name: true } },
        contact: { select: { name: true } },
        productService: { select: { name: true } },
      },
    }),
  ]);
  const owners = await userNames(rows.map((o) => o.ownerId));
  return {
    total,
    items: rows.map((o) => ({
      id: o.id,
      code: o.code,
      title: o.title,
      value: money(o.value),
      status: o.status,
      pipelineName: o.pipeline.name,
      stageName: o.stage.name,
      companyName: o.company?.name ?? null,
      contactName: o.contact?.name ?? null,
      productServiceName: o.productService?.name ?? null,
      ownerId: o.ownerId,
      ownerName: o.ownerId ? (owners.get(o.ownerId) ?? null) : null,
      expectedCloseDate: o.expectedCloseDate,
      closedAt: o.closedAt,
      outcomeReason: o.outcomeReason,
      createdAt: o.createdAt,
    })),
  };
}

export async function searchProposals(
  organizationId: string,
  a: { status?: ProposalStatus; companyId?: string; search?: string; range: Range; page: Page },
) {
  const db = tenantDb(organizationId);
  const where: Prisma.ProposalWhereInput = {
    status: a.status,
    companyId: a.companyId,
    ...(a.search
      ? { OR: [{ title: insensitive(a.search) }, { code: insensitive(a.search) }, { clientCompany: insensitive(a.search) }] }
      : {}),
    ...(a.range ? { createdAt: a.range } : {}),
  };
  const [total, rows] = await Promise.all([
    db.proposal.count({ where }),
    db.proposal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...a.page,
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        subtotal: true,
        discount: true,
        total: true,
        clientCompany: true,
        clientName: true,
        companyId: true,
        opportunityId: true,
        ownerId: true,
        validUntil: true,
        sentAt: true,
        decidedAt: true,
        createdAt: true,
      },
    }),
  ]);
  const owners = await userNames(rows.map((p) => p.ownerId));
  return {
    total,
    items: rows.map(({ ownerId, ...p }) => ({
      ...p,
      subtotal: money(p.subtotal),
      discount: money(p.discount),
      total: money(p.total),
      ownerName: ownerId ? (owners.get(ownerId) ?? null) : null,
    })),
  };
}

// ── resumo_vendas ────────────────────────────────────────────────────────────

const toCents = (v: Prisma.Decimal | null | undefined) => Math.round(Number(v ?? 0) * 100);
const fromCents = (c: number) => money(c / 100);

/** "YYYY-MM" of every month touched by the period, for the goals (Goal.month). */
function monthsOf(period: Period): string[] {
  const months: string[] = [];
  let y = Number(period.from.slice(0, 4));
  let m = Number(period.from.slice(5, 7));
  const last = period.to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.push(key);
    if (key >= last) return months;
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y++;
  }
}

/**
 * Sales over a period. "Closed in the period" uses `closedAt` and, for deals
 * closed before that field existed, `updatedAt` (the app's sales report uses
 * `updatedAt` for all). The open funnel is a snapshot of one pipeline now,
 * picked like the app does: the given one, else the default, else the first.
 */
export async function salesSummary(organizationId: string, period: Period, pipelineId?: string) {
  const db = tenantDb(organizationId);
  const inPeriod = { gte: period.gte, lt: period.lt };
  const closedInPeriod: Prisma.OpportunityWhereInput = {
    OR: [{ closedAt: inPeriod }, { closedAt: null, updatedAt: inPeriod }],
  };
  const pipelineSelect = { id: true, name: true } as const;
  const pipeline =
    (pipelineId ? await db.pipeline.findFirst({ where: { id: pipelineId }, select: pipelineSelect }) : null) ??
    (await db.pipeline.findFirst({ where: { isDefault: true }, orderBy: { order: "asc" }, select: pipelineSelect })) ??
    (await db.pipeline.findFirst({ orderBy: { order: "asc" }, select: pipelineSelect }));

  const [created, won, lost, canceled, lossGroups, stages, openGroups, goals, proposalGroups] = await Promise.all([
    db.opportunity.aggregate({ where: { createdAt: inPeriod }, _count: { _all: true }, _sum: { value: true } }),
    db.opportunity.findMany({ where: { status: "WON", ...closedInPeriod }, select: { value: true, ownerId: true } }),
    db.opportunity.aggregate({ where: { status: "LOST", ...closedInPeriod }, _count: { _all: true }, _sum: { value: true } }),
    db.opportunity.aggregate({
      where: { status: "CANCELED", ...closedInPeriod },
      _count: { _all: true },
      _sum: { value: true },
    }),
    db.opportunity.groupBy({
      by: ["outcomeReason"],
      where: { status: { in: ["LOST", "CANCELED"] }, outcomeReason: { not: null }, ...closedInPeriod },
      _count: { _all: true },
    }),
    pipeline
      ? db.stage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { order: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
    pipeline
      ? db.opportunity.groupBy({
          by: ["stageId"],
          where: { pipelineId: pipeline.id, status: "OPEN" },
          _count: { _all: true },
          _sum: { value: true },
        })
      : Promise.resolve([]),
    db.goal.findMany({ where: { month: { in: monthsOf(period) } }, select: { userId: true, targetValue: true } }),
    db.proposal.groupBy({
      by: ["status"],
      where: { createdAt: inPeriod },
      _count: { _all: true },
      _sum: { total: true },
    }),
  ]);

  const wonCents = won.reduce((acc, o) => acc + toCents(o.value), 0);
  const lostCount = lost._count._all;
  const closedCompetitive = won.length + lostCount;

  // Per owner: everyone who won something or had a goal in the period.
  const byOwnerMap = new Map<string, { wonCount: number; wonCents: number; goalCents: number | null }>();
  const ownerRow = (ownerId: string) => {
    let row = byOwnerMap.get(ownerId);
    if (!row) {
      row = { wonCount: 0, wonCents: 0, goalCents: null };
      byOwnerMap.set(ownerId, row);
    }
    return row;
  };
  for (const o of won) {
    if (!o.ownerId) continue;
    const row = ownerRow(o.ownerId);
    row.wonCount++;
    row.wonCents += toCents(o.value);
  }
  for (const g of goals) {
    const row = ownerRow(g.userId);
    row.goalCents = (row.goalCents ?? 0) + toCents(g.targetValue);
  }
  const names = await userNames([...byOwnerMap.keys()]);

  const openByStage = new Map(openGroups.map((g) => [g.stageId, g]));

  return {
    period: { from: period.from, to: period.to },
    pipeline,
    created: { count: created._count._all, value: fromCents(toCents(created._sum.value)) },
    won: {
      count: won.length,
      value: fromCents(wonCents),
      avgTicket: fromCents(won.length ? Math.round(wonCents / won.length) : 0),
    },
    lost: { count: lostCount, value: fromCents(toCents(lost._sum.value)) },
    canceled: { count: canceled._count._all, value: fromCents(toCents(canceled._sum.value)) },
    // won / (won + lost): a cancellation isn't a competitive loss (same as the app).
    winRate: closedCompetitive ? Math.round((won.length / closedCompetitive) * 10_000) / 10_000 : 0,
    lossReasons: lossGroups
      .map((g) => ({ reason: (g.outcomeReason ?? "").trim() || "—", count: g._count._all }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 8),
    openFunnel: stages.map((s) => {
      const g = openByStage.get(s.id);
      return {
        stageId: s.id,
        stageName: s.name,
        count: g?._count._all ?? 0,
        value: fromCents(toCents(g?._sum.value)),
      };
    }),
    byOwner: [...byOwnerMap]
      .map(([ownerId, r]) => ({
        ownerId,
        ownerName: names.get(ownerId) ?? null,
        wonCount: r.wonCount,
        wonValue: fromCents(r.wonCents),
        goal: r.goalCents === null ? null : fromCents(r.goalCents),
      }))
      .sort((x, y) => Number(y.wonValue) - Number(x.wonValue)),
    proposals: proposalGroups.map((g) => ({
      status: g.status,
      count: g._count._all,
      total: fromCents(toCents(g._sum.total)),
    })),
  };
}
