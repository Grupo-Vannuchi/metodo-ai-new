"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { assertFeatureByModules } from "@/config/modules";
import { audit } from "@/lib/audit";
import { audienceWhere, type AudienceFilter } from "@/lib/queries/campaigns";
import { getMyCloudNumber } from "@/lib/queries/inbox-oficial";
import { campaignSchema } from "@/lib/validations/campaign";
import { cloudGuard } from "@/lib/whatsapp-cloud/guard";
import {
  mappingIsComplete,
  templateVariables,
  toTemplateDef,
  unsupportedReason,
  type ParamContext,
  type ParamMapping,
} from "@/lib/whatsapp-cloud/template-params";

export type CloudCampaignResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "forbidden" | "no_connection" | "unknown" };

const paramSource = z.object({
  source: z.enum(["nome", "empresa", "fixo"]),
  value: z.string().max(1000).optional(),
});
const cloudCampaignSchema = campaignSchema
  .omit({ channel: true, templateId: true })
  .extend({ templateId: z.string().trim().min(1), params: z.record(z.string(), paramSource) });
const filterSchema = campaignSchema.pick({
  tags: true,
  folderId: true,
  source: true,
  stageId: true,
  oppStatus: true,
  ownerId: true,
});

function toFilter(d: z.infer<typeof filterSchema>): AudienceFilter {
  return {
    tags: d.tags,
    folderId: d.folderId || undefined,
    source: d.source || undefined,
    stageId: d.stageId || undefined,
    oppStatus: (d.oppStatus || undefined) as AudienceFilter["oppStatus"],
    ownerId: d.ownerId || undefined,
  };
}

/** Cria a Campaign (canal WHATSAPP_CLOUD) + destinatários + vínculo com o modelo da Meta. */
export async function createCloudCampaign(input: z.input<typeof cloudCampaignSchema>): Promise<CloudCampaignResult> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false, error: g.error === "unauthorized" ? "unauthorized" : "forbidden" };
  const { ctx } = g;
  try {
    assertFeatureByModules(ctx.modules, "campaigns.whatsapp");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const parsed = cloudCampaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const number = await getMyCloudNumber(ctx.organizationId, ctx.userId);
    if (!number || number.status !== "ACTIVE") return { ok: false, error: "no_connection" };
    const tpl = await db.whatsappCloudTemplate.findFirst({
      where: { id: parsed.data.templateId, wabaId: number.wabaId, status: "APPROVED" },
      select: { id: true, name: true, language: true, parameterFormat: true, components: true },
    });
    if (!tpl) return { ok: false, error: "invalid" };
    const def = toTemplateDef(tpl);
    if (unsupportedReason(def)) return { ok: false, error: "invalid" };
    const vars = templateVariables(def);
    const mapping: ParamMapping = {};
    for (const v of vars) {
      const m = parsed.data.params[v.id];
      if (m) mapping[v.id] = m;
    }
    if (!mappingIsComplete(vars, mapping)) return { ok: false, error: "invalid" };

    const contacts = await db.contact.findMany({
      where: audienceWhere("WHATSAPP_CLOUD", toFilter(parsed.data)),
      select: { id: true },
    });
    const campaign = await db.campaign.create({
      data: {
        organizationId: ctx.organizationId,
        name: parsed.data.name,
        channel: "WHATSAPP_CLOUD",
        templateId: null,
        status: "DRAFT",
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    if (contacts.length > 0) {
      await db.campaignRecipient.createMany({
        data: contacts.map((c) => ({ organizationId: ctx.organizationId, campaignId: campaign.id, contactId: c.id })),
        skipDuplicates: true,
      });
    }
    await db.whatsappCloudCampaign.create({
      data: {
        organizationId: ctx.organizationId,
        campaignId: campaign.id,
        numberId: number.id,
        templateId: tpl.id,
        params: mapping as Prisma.InputJsonValue,
      },
    });
    await audit(ctx, {
      action: "campaign.created",
      entity: "Campaign",
      entityId: campaign.id,
      meta: { channel: "WHATSAPP_CLOUD", recipients: contacts.length, template: tpl.name },
    });
    revalidatePath("/app/campaigns");
    return { ok: true, id: campaign.id };
  } catch (error) {
    console.error("[wa-cloud] create campaign failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Um contato real do público para a prévia do modelo. */
export async function sampleCloudAudience(filter: AudienceFilter): Promise<ParamContext | null> {
  const g = await cloudGuard();
  if (!g.ok) return null;
  const parsed = filterSchema.safeParse(filter);
  if (!parsed.success) return null;
  const c = await tenantDb(g.ctx.organizationId).contact.findFirst({
    where: audienceWhere("WHATSAPP_CLOUD", toFilter(parsed.data)),
    orderBy: { name: "asc" },
    select: { name: true, company: { select: { name: true } } },
  });
  return c ? { nome: c.name ?? "", empresa: c.company?.name ?? "" } : null;
}

/** Campanha oficial só troca o nome (para outro modelo, cria-se outra campanha). */
export async function renameCloudCampaign(id: string, name: string): Promise<{ ok: boolean }> {
  const g = await cloudGuard();
  if (!g.ok) return { ok: false };
  const clean = name.trim().slice(0, 120);
  if (!clean) return { ok: false };
  const db = tenantDb(g.ctx.organizationId);
  const link = await db.whatsappCloudCampaign.findFirst({ where: { campaignId: id }, select: { id: true } });
  if (!link) return { ok: false };
  const res = await db.campaign.updateMany({ where: { id }, data: { name: clean } });
  if (res.count === 0) return { ok: false };
  await audit(g.ctx, { action: "campaign.updated", entity: "Campaign", entityId: id });
  revalidatePath(`/app/campaigns/${id}`);
  revalidatePath("/app/campaigns");
  return { ok: true };
}
