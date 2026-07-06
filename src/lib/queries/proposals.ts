import "server-only";
import type { ProposalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";

export type ProposalStatusFilter = "ALL" | ProposalStatus;
export type ProposalPeriodFilter = "ALL" | "TODAY" | "7D" | "30D" | "MONTH" | "YEAR";

export const PROPOSAL_STATUS_FILTERS: ProposalStatusFilter[] = [
  "ALL",
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
];
export const PROPOSAL_PERIOD_FILTERS: ProposalPeriodFilter[] = ["ALL", "TODAY", "7D", "30D", "MONTH", "YEAR"];

/** Start-of-range Date for a period filter (null = no lower bound). */
function periodCutoff(period?: ProposalPeriodFilter): Date | null {
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

export type ProposalRow = {
  id: string;
  code: string | null;
  title: string;
  status: ProposalStatus;
  clientCompany: string | null;
  clientName: string | null;
  total: number;
  validUntil: Date | null;
  createdAt: Date;
};

/** Proposals list for the index screen, filtered by status + creation period. */
export async function listProposals(
  organizationId: string,
  opts: { status?: ProposalStatusFilter; period?: ProposalPeriodFilter; ownerId?: string } = {},
): Promise<ProposalRow[]> {
  const db = tenantDb(organizationId);
  const cutoff = periodCutoff(opts.period);
  const rows = await db.proposal.findMany({
    where: {
      ...(opts.status && opts.status !== "ALL" ? { status: opts.status } : {}),
      ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
      ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      clientCompany: true,
      clientName: true,
      total: true,
      validUntil: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}

/** A full proposal for the detail/edit/document views (org-scoped). */
export async function getProposal(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  const p = await db.proposal.findFirst({
    where: { id },
    include: {
      items: { orderBy: { order: "asc" } },
      opportunity: { select: { id: true, code: true, title: true } },
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, name: true } },
    },
  });
  if (!p) return null;

  const owner = p.ownerId
    ? await prisma.user.findUnique({ where: { id: p.ownerId }, select: { name: true } })
    : null;

  return {
    ...p,
    discount: Number(p.discount),
    subtotal: Number(p.subtotal),
    total: Number(p.total),
    ownerName: owner?.name ?? null,
    items: p.items.map((it) => ({
      id: it.id,
      productServiceId: it.productServiceId,
      name: it.name,
      description: it.description,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      total: Number(it.total),
      order: it.order,
    })),
  };
}

/** Attachment metadata for a proposal (never the bytes — those live in blob
 * storage). Loaded on the detail page; files are downloaded on demand. */
export async function listProposalAttachments(organizationId: string, proposalId: string) {
  const db = tenantDb(organizationId);
  return db.proposalAttachment.findMany({
    where: { proposalId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, mime: true, size: true, url: true, createdAt: true },
  });
}

export type ProposalFormOptions = {
  companies: { id: string; name: string; email: string | null; phone: string | null }[];
  contacts: { id: string; name: string; email: string | null; phone: string | null; companyId: string | null }[];
  products: { id: string; name: string; kind: "PRODUCT" | "SERVICE"; price: number | null }[];
};

/** Option lists for the proposal form (client snapshot + catalog items). */
export async function proposalFormOptions(organizationId: string): Promise<ProposalFormOptions> {
  const db = tenantDb(organizationId);
  const [companies, contacts, products] = await Promise.all([
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, email: true, phone: true } }),
    db.contact.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, phone: true, companyId: true },
    }),
    db.productService.findMany({
      where: { active: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      select: { id: true, name: true, kind: true, price: true },
    }),
  ]);
  return {
    companies,
    contacts,
    products: products.map((p) => ({ ...p, price: p.price == null ? null : Number(p.price) })),
  };
}

/** Prefill for "new proposal from an opportunity": pulls the client + product. */
export async function proposalPrefillFromOpportunity(organizationId: string, opportunityId: string) {
  const db = tenantDb(organizationId);
  const opp = await db.opportunity.findFirst({
    where: { id: opportunityId },
    select: {
      id: true,
      code: true,
      title: true,
      value: true,
      companyId: true,
      contactId: true,
      company: { select: { name: true, email: true, phone: true } },
      contact: { select: { name: true, email: true, phone: true } },
      productService: { select: { id: true, name: true, price: true } },
    },
  });
  if (!opp) return null;

  const ps = opp.productService;
  return {
    opportunityId: opp.id,
    title: opp.title,
    companyId: opp.companyId ?? "",
    contactId: opp.contactId ?? "",
    clientCompany: opp.company?.name ?? "",
    clientName: opp.contact?.name ?? "",
    clientEmail: opp.contact?.email ?? opp.company?.email ?? "",
    clientPhone: opp.contact?.phone ?? opp.company?.phone ?? "",
    item: ps
      ? {
          productServiceId: ps.id,
          name: ps.name,
          unitPrice: ps.price != null ? Number(ps.price) : Number(opp.value) || 0,
        }
      : Number(opp.value) > 0
        ? { productServiceId: "", name: opp.title, unitPrice: Number(opp.value) }
        : null,
  };
}
