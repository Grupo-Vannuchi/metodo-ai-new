"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
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
  model: "company" | "contact",
  id: string | undefined,
): Promise<string | null> {
  if (!id) return null;
  const db = tenantDb(organizationId);
  const found =
    model === "company"
      ? await db.company.findFirst({ where: { id }, select: { id: true } })
      : await db.contact.findFirst({ where: { id }, select: { id: true } });
  return found?.id ?? null;
}

export async function createOpportunity(
  input: OpportunityInput,
): Promise<OpportunityActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = opportunitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const stage = await db.stage.findFirst({
      where: { id: parsed.data.stageId },
      select: { id: true, pipelineId: true },
    });
    if (!stage) return { ok: false, error: "invalid" };

    const [companyId, contactId, order] = await Promise.all([
      existsInOrg(ctx.organizationId, "company", parsed.data.companyId),
      existsInOrg(ctx.organizationId, "contact", parsed.data.contactId),
      db.opportunity.count({ where: { stageId: stage.id } }),
    ]);

    const opp = await db.opportunity.create({
      data: {
        organizationId: ctx.organizationId,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        title: parsed.data.title,
        value: parsed.data.value,
        companyId,
        contactId,
        ownerId: ctx.userId,
        order,
      },
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

/** Edit an opportunity (title, value, stage, status, links). */
export async function updateOpportunity(
  id: string,
  input: UpdateOpportunityInput,
): Promise<OpportunityActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = updateOpportunitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const stage = await db.stage.findFirst({
      where: { id: parsed.data.stageId },
      select: { id: true, pipelineId: true },
    });
    if (!stage) return { ok: false, error: "invalid" };

    const [companyId, contactId] = await Promise.all([
      existsInOrg(ctx.organizationId, "company", parsed.data.companyId),
      existsInOrg(ctx.organizationId, "contact", parsed.data.contactId),
    ]);

    const res = await db.opportunity.updateMany({
      where: { id },
      data: {
        title: parsed.data.title,
        value: parsed.data.value,
        stageId: stage.id,
        pipelineId: stage.pipelineId,
        status: parsed.data.status,
        companyId,
        contactId,
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
