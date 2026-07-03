import "server-only";
import type { OpportunityStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";

export type BoardCard = {
  id: string;
  code: string | null;
  title: string;
  value: number;
  status: string;
  companyName: string | null;
  contactName: string | null;
  contactId: string | null;
  contactPhone: string | null;
  order: number;
};

export type BoardColumn = {
  id: string;
  name: string;
  probability: number;
  cards: BoardCard[];
};

export type Board = {
  pipelineId: string;
  pipelineName: string;
  columns: BoardColumn[];
};

/** The default pipeline (or the first one) for this org. */
async function defaultPipeline(organizationId: string) {
  const db = tenantDb(organizationId);
  return (
    (await db.pipeline.findFirst({
      where: { isDefault: true },
      orderBy: { order: "asc" },
    })) ?? (await db.pipeline.findFirst({ orderBy: { order: "asc" } }))
  );
}

// ── Board filters (status + period) ─────────────────────────────────────────
/** "ACTIVE" = the default board (open + on-hold); the rest narrow to one status. */
export type BoardStatusFilter = "ACTIVE" | "OPEN" | "ON_HOLD" | "WON" | "LOST" | "CANCELED";
export type BoardPeriodFilter = "ALL" | "TODAY" | "7D" | "30D" | "MONTH" | "YEAR";

export const BOARD_STATUS_FILTERS: BoardStatusFilter[] = ["ACTIVE", "OPEN", "ON_HOLD", "WON", "LOST", "CANCELED"];
export const BOARD_PERIOD_FILTERS: BoardPeriodFilter[] = ["ALL", "TODAY", "7D", "30D", "MONTH", "YEAR"];

/** The Prisma `status` condition for a board status filter. */
function boardStatusWhere(status?: BoardStatusFilter): OpportunityStatus | { in: OpportunityStatus[] } {
  switch (status) {
    case "OPEN":
    case "ON_HOLD":
    case "WON":
    case "LOST":
    case "CANCELED":
      return status;
    default:
      return { in: ["OPEN", "ON_HOLD"] };
  }
}

/** Start-of-range Date for a period filter (null = no lower bound). */
function periodCutoff(period?: BoardPeriodFilter): Date | null {
  const now = new Date();
  switch (period) {
    case "TODAY": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "7D": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    }
    case "30D": {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return d;
    }
    case "MONTH":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "YEAR":
      return new Date(now.getFullYear(), 0, 1);
    default:
      return null;
  }
}

/** The full Kanban board: ordered stages, each with its ordered cards. When
 * `pipelineId` is given (and belongs to the org) that pipeline is shown;
 * otherwise the default (also the fallback when a stale id no longer exists).
 * `filters` narrows the cards by status and creation period. */
export async function getBoard(
  organizationId: string,
  pipelineId?: string,
  ownerId?: string,
  filters: { status?: BoardStatusFilter; period?: BoardPeriodFilter } = {},
): Promise<Board | null> {
  const db = tenantDb(organizationId);
  const pipeline =
    (pipelineId ? await db.pipeline.findFirst({ where: { id: pipelineId } }) : null) ??
    (await defaultPipeline(organizationId));
  if (!pipeline) return null;

  const cutoff = periodCutoff(filters.period);
  const [stages, opportunities] = await Promise.all([
    db.stage.findMany({
      where: { pipelineId: pipeline.id },
      orderBy: { order: "asc" },
      select: { id: true, name: true, probability: true },
    }),
    db.opportunity.findMany({
      // Default board keeps OPEN + ON_HOLD (paused-but-open, badged); a status
      // filter narrows to one situation (closed ones show in their last stage).
      where: {
        pipelineId: pipeline.id,
        status: boardStatusWhere(filters.status),
        ...(ownerId ? { ownerId } : {}),
        ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
      },
      orderBy: { order: "asc" },
      select: {
        id: true,
        code: true,
        title: true,
        value: true,
        order: true,
        stageId: true,
        status: true,
        company: { select: { name: true } },
        contact: { select: { id: true, name: true, phone: true } },
      },
    }),
  ]);

  const columns: BoardColumn[] = stages.map((s) => ({
    id: s.id,
    name: s.name,
    probability: s.probability,
    cards: opportunities
      .filter((o) => o.stageId === s.id)
      .map((o) => ({
        id: o.id,
        code: o.code,
        title: o.title,
        value: Number(o.value),
        status: o.status,
        companyName: o.company?.name ?? null,
        contactName: o.contact?.name ?? null,
        contactId: o.contact?.id ?? null,
        contactPhone: o.contact?.phone ?? null,
        order: o.order,
      })),
  }));

  return { pipelineId: pipeline.id, pipelineName: pipeline.name, columns };
}

/** A single opportunity (edit + view pages). Scoped to the org; resolves the
 * stage/product/owner names for the read-only view. */
export async function getOpportunity(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  const opp = await db.opportunity.findFirst({
    where: { id },
    select: {
      id: true,
      code: true,
      title: true,
      value: true,
      stageId: true,
      status: true,
      companyId: true,
      contactId: true,
      productServiceId: true,
      ownerId: true,
      expectedCloseDate: true,
      notes: true,
      outcomeReason: true,
      closedAt: true,
      createdAt: true,
      company: { select: { name: true } },
      contact: { select: { name: true, phone: true } },
      stage: { select: { name: true } },
      productService: { select: { name: true } },
    },
  });
  if (!opp) return null;
  const owner = opp.ownerId
    ? await prisma.user.findUnique({ where: { id: opp.ownerId }, select: { name: true } })
    : null;
  return {
    ...opp,
    value: Number(opp.value),
    companyName: opp.company?.name ?? null,
    contactName: opp.contact?.name ?? null,
    contactPhone: opp.contact?.phone ?? null,
    stageName: opp.stage?.name ?? null,
    productServiceName: opp.productService?.name ?? null,
    ownerName: owner?.name ?? null,
  };
}

/** Open opportunities owned by a user (for the "My items" view). */
export async function listMyOpportunities(organizationId: string, userId: string, page = 1, pageSize = 10) {
  const db = tenantDb(organizationId);
  const where = { status: "OPEN" as const, ownerId: userId };
  
  const [total, opps] = await Promise.all([
    db.opportunity.count({ where }),
    db.opportunity.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, code: true, title: true, value: true, stage: { select: { name: true } } },
    }),
  ]);
  
  const data = opps.map((o) => ({
    id: o.id,
    code: o.code,
    title: o.title,
    value: Number(o.value),
    stageName: o.stage?.name ?? null,
  }));

  return { data, total };
}

export type ClosedStatusFilter = "LOST" | "CANCELED" | "WON" | "ALL";

/** Closed opportunities (won/lost/canceled) — the "archive" where deals go when
 * they leave the board. Used by the closed-opportunities page so they can be
 * found and reopened. */
export async function listClosedOpportunities(
  organizationId: string,
  opts: { status?: ClosedStatusFilter; ownerId?: string } = {},
) {
  const db = tenantDb(organizationId);
  const CLOSED: OpportunityStatus[] = ["LOST", "CANCELED", "WON"];
  const statusWhere = opts.status && opts.status !== "ALL" ? opts.status : { in: CLOSED };

  const opps = await db.opportunity.findMany({
    where: { status: statusWhere, ...(opts.ownerId ? { ownerId: opts.ownerId } : {}) },
    orderBy: [{ closedAt: "desc" }, { updatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      code: true,
      title: true,
      value: true,
      status: true,
      closedAt: true,
      outcomeReason: true,
      stage: { select: { name: true } },
      company: { select: { name: true } },
      contact: { select: { name: true } },
    },
  });

  return opps.map((o) => ({
    id: o.id,
    code: o.code,
    title: o.title,
    value: Number(o.value),
    status: o.status,
    closedAt: o.closedAt,
    outcomeReason: o.outcomeReason,
    stageName: o.stage?.name ?? null,
    companyName: o.company?.name ?? null,
    contactName: o.contact?.name ?? null,
  }));
}

/** Open opportunities (id + label) for linking tasks/finance. */
export async function opportunityOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  const opps = await db.opportunity.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, title: true, code: true },
  });
  return opps.map((o) => ({ id: o.id, name: o.code ? `${o.code} · ${o.title}` : o.title }));
}

/** Active catalog items for the opportunity form (id + label + price). */
export async function productServiceOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  const items = await db.productService.findMany({
    where: { active: true },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true, price: true },
  });
  return items.map((p) => ({ id: p.id, name: p.name, kind: p.kind, price: p.price ? Number(p.price) : null }));
}

export type ProductServiceRow = {
  id: string;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  price: number | null;
  active: boolean;
};

/** The full catalog (products + services), including inactive items, so the
 * manager can show and toggle everything. Ordered by kind then name. */
export async function listProductServices(
  organizationId: string,
): Promise<ProductServiceRow[]> {
  const db = tenantDb(organizationId);
  const items = await db.productService.findMany({
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true, price: true, active: true },
  });
  return items.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    price: p.price == null ? null : Number(p.price),
    active: p.active,
  }));
}

/** Stage options of a pipeline (for the create form). Defaults to the org's
 * default pipeline when `pipelineId` isn't given. */
export async function stageOptions(organizationId: string, pipelineId?: string) {
  const db = tenantDb(organizationId);
  const pipeline = pipelineId
    ? await db.pipeline.findFirst({ where: { id: pipelineId } })
    : await defaultPipeline(organizationId);
  if (!pipeline) return { pipelineId: null as string | null, stages: [] };
  const stages = await db.stage.findMany({
    where: { pipelineId: pipeline.id },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });
  return { pipelineId: pipeline.id, stages };
}

/** Attachment metadata for an opportunity (never the bytes — those live in blob
 * storage). Loaded on the detail page; the files are downloaded on demand. */
export async function listOpportunityAttachments(organizationId: string, opportunityId: string) {
  const db = tenantDb(organizationId);
  return db.opportunityAttachment.findMany({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, mime: true, size: true, url: true, createdAt: true },
  });
}
