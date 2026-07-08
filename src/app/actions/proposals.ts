"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { deleteMedia } from "@/lib/storage/blob";
import { getProposalTemplate } from "@/lib/queries/proposal-templates";
import { proposalPrefillFromOpportunity } from "@/lib/queries/proposals";
import {
  proposalSchema,
  updateProposalSchema,
  PROPOSAL_STATUSES,
  type ProposalInput,
  type UpdateProposalInput,
  type ProposalItemInput,
  type ProposalStatusKey,
} from "@/lib/validations/proposal";

export type ProposalActionResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

/** Round to cents to avoid float drift when persisting money. */
const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Verify an id belongs to this org for the given model; returns it or null. */
async function existsInOrg(
  organizationId: string,
  model: "company" | "contact" | "opportunity",
  id: string | undefined,
): Promise<string | null> {
  if (!id) return null;
  const db = tenantDb(organizationId);
  const found =
    model === "company"
      ? await db.company.findFirst({ where: { id }, select: { id: true } })
      : model === "contact"
        ? await db.contact.findFirst({ where: { id }, select: { id: true } })
        : await db.opportunity.findFirst({ where: { id }, select: { id: true } });
  return found?.id ?? null;
}

const dateOrNull = (s?: string) => (s && s.trim() ? new Date(s) : null);

type ComputedItem = {
  productServiceId: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  order: number;
};

/** Normalize items and compute the money totals (subtotal/total). */
function computeTotals(items: ProposalItemInput[], discountRaw: number) {
  const computed: ComputedItem[] = items.map((it, i) => {
    const quantity = money(it.quantity);
    const unitPrice = money(it.unitPrice);
    return {
      productServiceId: it.productServiceId ? it.productServiceId : null,
      name: it.name.trim(),
      description: it.description?.trim() || null,
      quantity,
      unitPrice,
      total: money(quantity * unitPrice),
      order: i,
    };
  });
  const subtotal = money(computed.reduce((s, it) => s + it.total, 0));
  const discount = Math.min(money(discountRaw), subtotal);
  const total = money(subtotal - discount);
  return { computed, subtotal, discount, total };
}

export async function createProposal(input: ProposalInput): Promise<ProposalActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const [companyId, contactId, opportunityId] = await Promise.all([
      existsInOrg(org, "company", parsed.data.companyId),
      existsInOrg(org, "contact", parsed.data.contactId),
      existsInOrg(org, "opportunity", parsed.data.opportunityId),
    ]);

    const { computed, subtotal, discount, total } = computeTotals(parsed.data.items, parsed.data.discount);

    const year = new Date().getFullYear();
    const yy = String(year).slice(-2);

    // Sequential code must be atomic with the insert (per org/year).
    const proposal = await prisma.$transaction(async (tx) => {
      const last = await tx.proposal.findFirst({
        where: { organizationId: org, seqYear: year },
        orderBy: { seqNumber: "desc" },
        select: { seqNumber: true },
      });
      const seqNumber = (last?.seqNumber ?? 0) + 1;
      const code = `PROP-${String(seqNumber).padStart(4, "0")}/${yy}`;
      return tx.proposal.create({
        data: {
          organizationId: org,
          code,
          seqYear: year,
          seqNumber,
          title: parsed.data.title,
          opportunityId,
          companyId,
          contactId,
          clientCompany: parsed.data.clientCompany || null,
          clientName: parsed.data.clientName || null,
          clientEmail: parsed.data.clientEmail || null,
          clientPhone: parsed.data.clientPhone || null,
          clientAddress: parsed.data.clientAddress || null,
          intro: parsed.data.intro || null,
          notes: parsed.data.notes || null,
          validUntil: dateOrNull(parsed.data.validUntil),
          discount,
          subtotal,
          total,
          ownerId: ctx.userId,
          createdById: ctx.userId,
          items: {
            create: computed.map((it) => ({ organizationId: org, ...it })),
          },
        },
        select: { id: true },
      });
    });

    revalidatePath("/app/proposals");
    return { ok: true, id: proposal.id };
  } catch (error) {
    console.error("Failed to create proposal", error);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Create a draft proposal pre-filled from an org template (and, optionally, an
 * opportunity's client data). The template's rich document is copied verbatim
 * ({{variables}} intact — they resolve at export), while items/discount/validity
 * become the proposal's commercial data. Returns the new proposal to open.
 */
export async function createProposalFromTemplate(input: {
  templateId: string;
  opportunityId?: string;
}): Promise<ProposalActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  try {
    const org = ctx.organizationId;
    const template = await getProposalTemplate(org, input.templateId);
    if (!template) return { ok: false, error: "invalid" };

    const prefill = input.opportunityId
      ? await proposalPrefillFromOpportunity(org, input.opportunityId)
      : null;

    const items: ProposalItemInput[] = template.items.map((it) => ({
      productServiceId: it.productServiceId ?? "",
      name: it.name,
      description: it.description ?? "",
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    }));
    const { computed, subtotal, discount, total } = computeTotals(items, template.discount);

    const now = new Date();
    const validUntil =
      template.validityDays != null ? new Date(now.getTime() + template.validityDays * 86_400_000) : null;
    const title = (prefill?.title || template.name).slice(0, 200);

    const year = now.getFullYear();
    const yy = String(year).slice(-2);

    const proposal = await prisma.$transaction(async (tx) => {
      const last = await tx.proposal.findFirst({
        where: { organizationId: org, seqYear: year },
        orderBy: { seqNumber: "desc" },
        select: { seqNumber: true },
      });
      const seqNumber = (last?.seqNumber ?? 0) + 1;
      const code = `PROP-${String(seqNumber).padStart(4, "0")}/${yy}`;
      return tx.proposal.create({
        data: {
          organizationId: org,
          code,
          seqYear: year,
          seqNumber,
          title,
          opportunityId: prefill ? (input.opportunityId ?? null) : null,
          companyId: prefill?.companyId || null,
          contactId: prefill?.contactId || null,
          clientCompany: prefill?.clientCompany || null,
          clientName: prefill?.clientName || null,
          clientEmail: prefill?.clientEmail || null,
          clientPhone: prefill?.clientPhone || null,
          document: template.document as unknown as Prisma.InputJsonValue,
          discount,
          subtotal,
          total,
          validUntil,
          ownerId: ctx.userId,
          createdById: ctx.userId,
          items: { create: computed.map((it) => ({ organizationId: org, ...it })) },
        },
        select: { id: true },
      });
    });

    revalidatePath("/app/proposals");
    return { ok: true, id: proposal.id };
  } catch (error) {
    console.error("Failed to create proposal from template", error);
    return { ok: false, error: "unknown" };
  }
}

/** Set the status timestamps (sentAt/decidedAt) for a transition. */
function statusTimestamps(
  status: ProposalStatusKey,
  current: { sentAt: Date | null; decidedAt: Date | null },
): { sentAt: Date | null; decidedAt: Date | null } {
  const now = new Date();
  const decided = status === "ACCEPTED" || status === "REJECTED" || status === "EXPIRED";
  return {
    sentAt: status === "DRAFT" ? current.sentAt : (current.sentAt ?? now),
    decidedAt: decided ? (current.decidedAt ?? now) : null,
  };
}

export async function updateProposal(id: string, input: UpdateProposalInput): Promise<ProposalActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = updateProposalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const db = tenantDb(org);
    const current = await db.proposal.findFirst({
      where: { id },
      select: { id: true, sentAt: true, decidedAt: true },
    });
    if (!current) return { ok: false, error: "unknown" };

    const [companyId, contactId, opportunityId] = await Promise.all([
      existsInOrg(org, "company", parsed.data.companyId),
      existsInOrg(org, "contact", parsed.data.contactId),
      existsInOrg(org, "opportunity", parsed.data.opportunityId),
    ]);

    const { computed, subtotal, discount, total } = computeTotals(parsed.data.items, parsed.data.discount);
    const ts = statusTimestamps(parsed.data.status, current);

    await prisma.$transaction([
      prisma.proposal.updateMany({
        where: { id, organizationId: org },
        data: {
          title: parsed.data.title,
          status: parsed.data.status,
          opportunityId,
          companyId,
          contactId,
          clientCompany: parsed.data.clientCompany || null,
          clientName: parsed.data.clientName || null,
          clientEmail: parsed.data.clientEmail || null,
          clientPhone: parsed.data.clientPhone || null,
          clientAddress: parsed.data.clientAddress || null,
          intro: parsed.data.intro || null,
          notes: parsed.data.notes || null,
          validUntil: dateOrNull(parsed.data.validUntil),
          discount,
          subtotal,
          total,
          sentAt: ts.sentAt,
          decidedAt: ts.decidedAt,
        },
      }),
      prisma.proposalItem.deleteMany({ where: { proposalId: id, organizationId: org } }),
      prisma.proposalItem.createMany({
        data: computed.map((it) => ({ ...it, organizationId: org, proposalId: id })),
      }),
    ]);

    revalidatePath("/app/proposals");
    revalidatePath(`/app/proposals/${id}`);
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update proposal", error);
    return { ok: false, error: "unknown" };
  }
}

/** Quick status change from the detail page (no full form). */
export async function setProposalStatus(id: string, status: ProposalStatusKey): Promise<ProposalActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!PROPOSAL_STATUSES.includes(status)) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const current = await db.proposal.findFirst({ where: { id }, select: { sentAt: true, decidedAt: true } });
    if (!current) return { ok: false, error: "unknown" };

    const ts = statusTimestamps(status, current);
    const res = await db.proposal.updateMany({ where: { id }, data: { status, sentAt: ts.sentAt, decidedAt: ts.decidedAt } });
    if (res.count === 0) return { ok: false, error: "unknown" };

    revalidatePath("/app/proposals");
    revalidatePath(`/app/proposals/${id}`);
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to set proposal status", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteProposal(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    // Drop attachment blobs before the rows cascade away (best-effort).
    const atts = await db.proposalAttachment.findMany({ where: { proposalId: id }, select: { url: true } });
    await Promise.all(atts.map((a) => deleteMedia(a.url).catch(() => {})));
    await db.proposal.deleteMany({ where: { id } });
    revalidatePath("/app/proposals");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete proposal", error);
    return { ok: false };
  }
}

/** Remove one attachment: delete the row and its blob. */
export async function deleteProposalAttachment(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    const att = await db.proposalAttachment.findFirst({ where: { id }, select: { url: true, proposalId: true } });
    if (!att) return { ok: false };
    await db.proposalAttachment.deleteMany({ where: { id } });
    await deleteMedia(att.url).catch(() => {});
    revalidatePath(`/app/proposals/${att.proposalId}`);
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete proposal attachment", error);
    return { ok: false };
  }
}
