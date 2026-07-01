"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { assertFeature, type PlanKey } from "@/config/plans";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import {
  resolveChannelCredentials,
  dispatchCampaignToCompletion,
} from "@/lib/dispatch";
import { CHANNEL_META, CHANNEL_KEYS, type ChannelKey } from "@/lib/integrations/channels/meta";
import { audienceWhere, type AudienceFilter } from "@/lib/queries/campaigns";
import { audit } from "@/lib/audit";
import {
  templateSchema,
  campaignSchema,
  campaignUpdateSchema,
  type TemplateInput,
  type CampaignInput,
  type CampaignUpdateInput,
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

export async function updateTemplate(
  id: string,
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
    const existing = await db.messageTemplate.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!existing) return { ok: false, error: "invalid" };

    await db.messageTemplate.updateMany({
      where: { id },
      data: {
        channel,
        name: parsed.data.name,
        subject: parsed.data.subject || null,
        body: parsed.data.body,
      },
    });
    revalidatePath("/app/campaigns/templates");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update template", error);
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

    // Audience: reachable, non-opted-out contacts narrowed by the segmentation
    // filters (audienceWhere also enforces the LGPD opt-out exclusion).
    const filter: AudienceFilter = {
      tags: parsed.data.tags,
      folderId: parsed.data.folderId || undefined,
      source: parsed.data.source || undefined,
      stageId: parsed.data.stageId || undefined,
      oppStatus: parsed.data.oppStatus || undefined,
      ownerId: parsed.data.ownerId || undefined,
    };
    const contacts = await db.contact.findMany({
      where: audienceWhere(channel, filter),
      select: { id: true },
    });

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

    await audit(ctx, {
      action: "campaign.created",
      entity: "Campaign",
      entityId: campaign.id,
      meta: { channel, recipients: contacts.length },
    });
    revalidatePath("/app/campaigns");
    return { ok: true, id: campaign.id };
  } catch (error) {
    console.error("Failed to create campaign", error);
    return { ok: false, error: "unknown" };
  }
}

/** Live recipient count for the audience filters — drives the create form. */
export async function countAudience(
  channel: string,
  filter: AudienceFilter,
): Promise<number> {
  const ctx = await getOrgContext();
  if (!ctx || !CHANNEL_KEYS.includes(channel as ChannelKey)) return 0;
  try {
    const db = tenantDb(ctx.organizationId);
    return await db.contact.count({ where: audienceWhere(channel as ChannelKey, filter) });
  } catch (error) {
    console.error("Failed to count audience", error);
    return 0;
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

    // Re-dispatch: when every recipient was already processed (a finished
    // campaign), reset them all to PENDING so the whole campaign sends again.
    // A campaign still mid-flight (some PENDING left) just resumes the rest.
    const pending = await db.campaignRecipient.count({
      where: { campaignId: id, status: "PENDING" },
    });
    if (pending === 0) {
      await db.campaignRecipient.updateMany({
        where: { campaignId: id },
        data: {
          status: "PENDING",
          error: null,
          providerMessageId: null,
          sentAt: null,
        },
      });
    }

    // Stamp lastDispatchAt so the per-minute cron doesn't also enqueue a job
    // (we enqueue the first one right here).
    await db.campaign.updateMany({
      where: { id },
      data: { status: "RUNNING", lastDispatchAt: new Date() },
    });

    await audit(ctx, { action: "campaign.started", entity: "Campaign", entityId: id });

    if (isQueueConfigured()) {
      await enqueue("dispatch-campaign", { campaignId: id });
    } else {
      // Dev/no-queue: run in the background so the request isn't blocked while
      // the campaign paces itself out.
      void dispatchCampaignToCompletion(id).catch((e) => console.error("dispatch failed", e));
    }

    revalidatePath(`/app/campaigns/${id}`);
    revalidatePath("/app/campaigns");
    return { ok: true };
  } catch (error) {
    console.error("Failed to start campaign", error);
    return { ok: false, error: "unknown" };
  }
}

/** Edit a campaign's name and message template (channel/audience stay fixed). */
export async function updateCampaign(
  id: string,
  input: CampaignUpdateInput,
): Promise<CampaignActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = campaignUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const campaign = await db.campaign.findFirst({
      where: { id },
      select: { id: true, channel: true },
    });
    if (!campaign) return { ok: false, error: "invalid" };

    // The new template must exist and match the campaign's channel.
    const template = await db.messageTemplate.findFirst({
      where: { id: parsed.data.templateId, channel: campaign.channel },
      select: { id: true },
    });
    if (!template) return { ok: false, error: "invalid" };

    await db.campaign.updateMany({
      where: { id },
      data: { name: parsed.data.name, templateId: template.id },
    });
    await audit(ctx, { action: "campaign.updated", entity: "Campaign", entityId: id });
    revalidatePath(`/app/campaigns/${id}`);
    revalidatePath("/app/campaigns");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update campaign", error);
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
