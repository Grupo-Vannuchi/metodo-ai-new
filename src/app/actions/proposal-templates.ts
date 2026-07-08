"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import {
  proposalTemplateSchema,
  type ProposalTemplateInput,
  type TemplateItemInput,
} from "@/lib/validations/proposal-template";

export type TemplateActionResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

/** Round to cents to avoid float drift when persisting money. */
const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Normalize the template's default line items (trim + money + order). */
function normItems(items: TemplateItemInput[]) {
  return items.map((it, i) => ({
    productServiceId: it.productServiceId ? it.productServiceId : null,
    name: it.name.trim(),
    description: it.description?.trim() || null,
    quantity: money(it.quantity),
    unitPrice: money(it.unitPrice),
    order: i,
  }));
}

export async function createProposalTemplate(input: ProposalTemplateInput): Promise<TemplateActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = proposalTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const items = normItems(parsed.data.items);
    const t = await prisma.proposalTemplate.create({
      data: {
        organizationId: org,
        name: parsed.data.name,
        document: parsed.data.document as unknown as Prisma.InputJsonValue,
        validityDays: parsed.data.validityDays ?? null,
        discount: money(parsed.data.discount),
        ownerId: ctx.userId,
        createdById: ctx.userId,
        items: { create: items.map((it) => ({ organizationId: org, ...it })) },
      },
      select: { id: true },
    });
    revalidatePath("/app/proposals/templates");
    return { ok: true, id: t.id };
  } catch (error) {
    console.error("Failed to create proposal template", error);
    return { ok: false, error: "unknown" };
  }
}

export async function updateProposalTemplate(
  id: string,
  input: ProposalTemplateInput,
): Promise<TemplateActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = proposalTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const db = tenantDb(org);
    const current = await db.proposalTemplate.findFirst({ where: { id }, select: { id: true } });
    if (!current) return { ok: false, error: "unknown" };

    const items = normItems(parsed.data.items);
    await prisma.$transaction([
      prisma.proposalTemplate.updateMany({
        where: { id, organizationId: org },
        data: {
          name: parsed.data.name,
          document: parsed.data.document as unknown as Prisma.InputJsonValue,
          validityDays: parsed.data.validityDays ?? null,
          discount: money(parsed.data.discount),
        },
      }),
      prisma.proposalTemplateItem.deleteMany({ where: { templateId: id, organizationId: org } }),
      prisma.proposalTemplateItem.createMany({
        data: items.map((it) => ({ ...it, organizationId: org, templateId: id })),
      }),
    ]);

    revalidatePath("/app/proposals/templates");
    revalidatePath(`/app/proposals/templates/${id}/edit`);
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update proposal template", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteProposalTemplate(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    await db.proposalTemplate.deleteMany({ where: { id } });
    revalidatePath("/app/proposals/templates");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete proposal template", error);
    return { ok: false };
  }
}
