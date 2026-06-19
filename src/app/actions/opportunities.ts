"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import {
  opportunitySchema,
  moveOpportunitySchema,
  updateOpportunitySchema,
  type OpportunityInput,
  type MoveOpportunityInput,
  type UpdateOpportunityInput,
} from "@/lib/validations/opportunity";

export type OpportunityActionResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

/** Verify an id exists in this org for the given model; returns it or null. */
async function existsInOrg(
  organizationId: string,
  model: "company" | "contact" | "productService",
  id: string | undefined,
): Promise<string | null> {
  if (!id) return null;
  const db = tenantDb(organizationId);
  const found =
    model === "company"
      ? await db.company.findFirst({ where: { id }, select: { id: true } })
      : model === "contact"
        ? await db.contact.findFirst({ where: { id }, select: { id: true } })
        : await db.productService.findFirst({ where: { id }, select: { id: true } });
  return found?.id ?? null;
}

/** Resolve the responsible member (must belong to the org); else the fallback. */
async function resolveOwner(
  organizationId: string,
  ownerId: string | undefined,
  fallback: string | null,
): Promise<string | null> {
  if (!ownerId) return fallback;
  const m = await prisma.membership.findFirst({
    where: { organizationId, userId: ownerId },
    select: { userId: true },
  });
  return m?.userId ?? fallback;
}

const dateOrNull = (s?: string) => (s && s.trim() ? new Date(s) : null);

export async function createOpportunity(
  input: OpportunityInput,
): Promise<OpportunityActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = opportunitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const db = tenantDb(org);
    const stage = await db.stage.findFirst({
      where: { id: parsed.data.stageId },
      select: { id: true, pipelineId: true },
    });
    if (!stage) return { ok: false, error: "invalid" };

    const [companyId, contactId, productServiceId, ownerId] = await Promise.all([
      existsInOrg(org, "company", parsed.data.companyId),
      existsInOrg(org, "contact", parsed.data.contactId),
      existsInOrg(org, "productService", parsed.data.productServiceId),
      resolveOwner(org, parsed.data.ownerId, ctx.userId),
    ]);

    const year = new Date().getFullYear();
    const yy = String(year).slice(-2);

    // Code generation must be atomic with the insert (per org/year sequence).
    const opp = await prisma.$transaction(async (tx) => {
      const order = await tx.opportunity.count({
        where: { organizationId: org, stageId: stage.id },
      });
      const last = await tx.opportunity.findFirst({
        where: { organizationId: org, seqYear: year },
        orderBy: { seqNumber: "desc" },
        select: { seqNumber: true },
      });
      const seqNumber = (last?.seqNumber ?? 0) + 1;
      const code = `${String(seqNumber).padStart(4, "0")}/${yy}`;
      return tx.opportunity.create({
        data: {
          organizationId: org,
          pipelineId: stage.pipelineId,
          stageId: stage.id,
          title: parsed.data.title,
          value: parsed.data.value,
          companyId,
          contactId,
          productServiceId,
          ownerId,
          expectedCloseDate: dateOrNull(parsed.data.expectedCloseDate),
          notes: parsed.data.notes || null,
          order,
          seqYear: year,
          seqNumber,
          code,
        },
        select: { id: true },
      });
    });

    revalidatePath("/app/crm");
    return { ok: true, id: opp.id };
  } catch (error) {
    console.error("Failed to create opportunity", error);
    return { ok: false, error: "unknown" };
  }
}

/** Move a card to another stage (appended to the end of the destination column). */
export async function moveOpportunity(
  input: MoveOpportunityInput,
): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  const parsed = moveOpportunitySchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    const [opp, stage] = await Promise.all([
      db.opportunity.findFirst({
        where: { id: parsed.data.opportunityId },
        select: { id: true },
      }),
      db.stage.findFirst({
        where: { id: parsed.data.toStageId },
        select: { id: true, pipelineId: true },
      }),
    ]);
    if (!opp || !stage) return { ok: false };

    const order = await db.opportunity.count({ where: { stageId: stage.id } });
    await db.opportunity.updateMany({
      where: { id: opp.id },
      data: { stageId: stage.id, pipelineId: stage.pipelineId, order },
    });
    revalidatePath("/app/crm");
    return { ok: true };
  } catch (error) {
    console.error("Failed to move opportunity", error);
    return { ok: false };
  }
}

/** Edit an opportunity (fields + status lifecycle). */
export async function updateOpportunity(
  id: string,
  input: UpdateOpportunityInput,
): Promise<OpportunityActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = updateOpportunitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const db = tenantDb(org);
    const [stage, current] = await Promise.all([
      db.stage.findFirst({ where: { id: parsed.data.stageId }, select: { id: true, pipelineId: true } }),
      db.opportunity.findFirst({ where: { id }, select: { closedAt: true } }),
    ]);
    if (!stage || !current) return { ok: false, error: "invalid" };

    const [companyId, contactId, productServiceId, ownerId] = await Promise.all([
      existsInOrg(org, "company", parsed.data.companyId),
      existsInOrg(org, "contact", parsed.data.contactId),
      existsInOrg(org, "productService", parsed.data.productServiceId),
      resolveOwner(org, parsed.data.ownerId, null),
    ]);

    const status = parsed.data.status;
    const closedAt = status === "OPEN" ? null : (current.closedAt ?? new Date());
    const outcomeReason =
      status === "LOST" || status === "CANCELED" ? parsed.data.outcomeReason || null : null;

    const res = await db.opportunity.updateMany({
      where: { id },
      data: {
        title: parsed.data.title,
        value: parsed.data.value,
        stageId: stage.id,
        pipelineId: stage.pipelineId,
        status,
        companyId,
        contactId,
        productServiceId,
        ownerId,
        expectedCloseDate: dateOrNull(parsed.data.expectedCloseDate),
        notes: parsed.data.notes || null,
        closedAt,
        outcomeReason,
      },
    });
    if (res.count === 0) return { ok: false, error: "unknown" };

    revalidatePath("/app/crm");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update opportunity", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteOpportunity(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    await db.opportunity.deleteMany({ where: { id } });
    revalidatePath("/app/crm");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete opportunity", error);
    return { ok: false };
  }
}
