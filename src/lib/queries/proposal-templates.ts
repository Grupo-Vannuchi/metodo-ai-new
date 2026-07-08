import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import {
  proposalDocumentSchema,
  emptyDocument,
  type ProposalDocument,
} from "@/lib/validations/proposal-template";

/** Safely parse a stored document JSON back to the typed shape (empty on drift). */
export function parseDocument(value: unknown): ProposalDocument {
  const parsed = proposalDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyDocument();
}

export type ProposalTemplateRow = {
  id: string;
  name: string;
  sectionCount: number;
  itemCount: number;
  validityDays: number | null;
  discount: number;
  updatedAt: Date;
};

/** Org-shared template list for the templates index. */
export async function listProposalTemplates(organizationId: string): Promise<ProposalTemplateRow[]> {
  const db = tenantDb(organizationId);
  const rows = await db.proposalTemplate.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      document: true,
      validityDays: true,
      discount: true,
      updatedAt: true,
      _count: { select: { items: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sectionCount: parseDocument(r.document).sections.length,
    itemCount: r._count.items,
    validityDays: r.validityDays,
    discount: Number(r.discount),
    updatedAt: r.updatedAt,
  }));
}

/** Lightweight {id, name} list for the "generate from template" picker. */
export async function listProposalTemplateOptions(
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  const db = tenantDb(organizationId);
  return db.proposalTemplate.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export type ProposalTemplateDetail = {
  id: string;
  name: string;
  document: ProposalDocument;
  validityDays: number | null;
  discount: number;
  items: {
    productServiceId: string | null;
    name: string;
    description: string | null;
    quantity: number;
    unitPrice: number;
  }[];
};

/** A full template for the editor (org-scoped). */
export async function getProposalTemplate(
  organizationId: string,
  id: string,
): Promise<ProposalTemplateDetail | null> {
  const db = tenantDb(organizationId);
  const t = await db.proposalTemplate.findFirst({
    where: { id },
    include: { items: { orderBy: { order: "asc" } } },
  });
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    document: parseDocument(t.document),
    validityDays: t.validityDays,
    discount: Number(t.discount),
    items: t.items.map((it) => ({
      productServiceId: it.productServiceId,
      name: it.name,
      description: it.description,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
    })),
  };
}
