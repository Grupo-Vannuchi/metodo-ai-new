"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { assertFeature, type PlanKey } from "@/config/plans";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import {
  resolveChannelCredentials,
  dispatchCampaignToCompletion,
} from "@/lib/dispatch";
import { CHANNEL_META, type ChannelKey } from "@/lib/integrations/channels/meta";
import {
  templateSchema,
  campaignSchema,
  type TemplateInput,
  type CampaignInput,
} from "@/lib/validations/campaign";

export type CampaignActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "unauthorized" | "invalid" | "forbidden" | "no_connection" | "unknown";
    };

function assertChannel(plan: PlanKey, channel: ChannelKey): boolean {
  try {
    assertFeature(plan, CHANNEL_META[channel].feature);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Templates

export async function createTemplate(
  input: TemplateInput,
): Promise<CampaignActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const channel = parsed.data.channel as ChannelKey;
  if (!assertChannel(ctx.organization.plan as PlanKey, channel)) {
    return { ok: false, error: "forbidden" };
  }

  try {
    const db = tenantDb(ctx.organizationId);
    const tpl = await db.messageTemplate.create({
      data: {
        organizationId: ctx.organizationId,
        channel,
        name: parsed.data.name,
        subject: parsed.data.subject || null,
        body: parsed.data.body,
      },
    });
    revalidatePath("/app/campaigns/templates");
    return { ok: true, id: tpl.id };
  } catch (error) {
    console.error("Failed to create template", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteTemplate(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    await db.messageTemplate.deleteMany({ where: { id } });
    revalidatePath("/app/campaigns/templates");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete template", error);
    return { ok: false };
  }
}

// ---------------------------------------------------------------- Campaigns

export async function createCampaign(
  input: CampaignInput,
): Promise<CampaignActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const channel = parsed.data.channel as ChannelKey;
  if (!assertChannel(ctx.organization.plan as PlanKey, channel)) {
    return { ok: false, error: "forbidden" };
  }

  try {
    const db = tenantDb(ctx.organizationId);
    const template = await db.messageTemplate.findFirst({
      where: { id: parsed.data.templateId, channel },
      select: { id: true },
    });
    if (!template) return { ok: false, error: "invalid" };

    // Audience: contacts that have the channel's destination field, optional tag.
    const targetField = CHANNEL_META[channel].target;
    const where: Prisma.ContactWhereInput =
      targetField === "phone" ? { phone: { not: null } } : { email: { not: null } };
    if (parsed.data.tag) where.tags = { has: parsed.data.tag };

    const contacts = await db.contact.findMany({ where, select: { id: true } });

    const campaign = await db.campaign.create({
      data: {
        organizationId: ctx.organizationId,
        name: parsed.data.name,
        channel,
        templateId: template.id,
        status: "DRAFT",
        createdById: ctx.userId,
      },
    });

    if (contacts.length > 0) {
      await db.campaignRecipient.createMany({
        data: contacts.map((c) => ({
          organizationId: ctx.organizationId,
          campaignId: campaign.id,
          contactId: c.id,
        })),
        skipDuplicates: true,
      });
    }

    revalidatePath("/app/campaigns");
    return { ok: true, id: campaign.id };
  } catch (error) {
    console.error("Failed to create campaign", error);
    return { ok: false, error: "unknown" };
  }
}

/** Start (or resume) sending a campaign. */
export async function startCampaign(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  try {
    const db = tenantDb(ctx.organizationId);
    const campaign = await db.campaign.findFirst({
      where: { id },
      select: { id: true, channel: true },
    });
    if (!campaign) return { ok: false, error: "invalid" };

    const channel = campaign.channel as ChannelKey;
    const creds = await resolveChannelCredentials(ctx.organizationId, channel);
    if (!creds) return { ok: false, error: "no_connection" };

    await db.campaign.updateMany({ where: { id }, data: { status: "RUNNING" } });

    if (isQueueConfigured()) {
      await enqueue("dispatch-campaign", { campaignId: id });
    } else {
      await dispatchCampaignToCompletion(id);
    }

    revalidatePath(`/app/campaigns/${id}`);
    revalidatePath("/app/campaigns");
    return { ok: true };
  } catch (error) {
    console.error("Failed to start campaign", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteCampaign(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    await db.campaign.deleteMany({ where: { id } });
    revalidatePath("/app/campaigns");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete campaign", error);
    return { ok: false };
  }
}
