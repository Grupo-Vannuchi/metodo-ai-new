import "server-only";
import { prisma } from "@/lib/prisma";
import { getChannelAdapter } from "@/lib/integrations/channels";
import { CHANNEL_META, type ChannelKey } from "@/lib/integrations/channels/meta";
import type { ChannelCredentials } from "@/lib/integrations/channels/types";
import { resolveCredentials } from "@/lib/integrations/credentials";
import { decryptCredentials } from "@/lib/integrations/crypto";
import { makeRateLimiter } from "@/lib/ratelimit";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import { planConfig, type PlanKey } from "@/config/plans";

const BATCH = 25;

/** Per-channel sliding-window rate limit (events per window). */
const RATE: Record<ChannelKey, { limit: number; windowSec: number }> = {
  WHATSAPP_EVOLUTION: { limit: 20, windowSec: 60 },
  WHATSAPP_CLOUD: { limit: 60, windowSec: 60 },
  EMAIL: { limit: 100, windowSec: 60 },
};

export type ChannelCreds = { credentials: ChannelCredentials; from?: string };

/**
 * Resolve the credentials a channel sends with. EMAIL falls back to the
 * platform Resend key; WhatsApp channels require the tenant's own connection.
 */
export async function resolveChannelCredentials(
  organizationId: string,
  channel: ChannelKey,
): Promise<ChannelCreds | null> {
  const provider = CHANNEL_META[channel].connectionProvider;

  if (provider === "RESEND") {
    const resolved = await resolveCredentials(organizationId, "RESEND");
    if (!resolved) return null;
    return { credentials: resolved.credentials, from: resolved.credentials.fromEmail };
  }

  // EVOLUTION / META_CLOUD — tenant connection only.
  const conn = await prisma.integrationConnection.findFirst({
    where: { organizationId, provider },
    orderBy: { createdAt: "desc" },
  });
  if (!conn) return null;
  try {
    return { credentials: decryptCredentials(conn.credentialsEnc) };
  } catch {
    return null;
  }
}

export function renderTemplate(
  body: string,
  vars: { nome: string; empresa: string },
): string {
  return body
    .replace(/\{\{\s*nome\s*\}\}/gi, vars.nome)
    .replace(/\{\{\s*empresa\s*\}\}/gi, vars.empresa);
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

async function pause(campaignId: string): Promise<void> {
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "PAUSED" },
  });
}

/**
 * Process one batch of a RUNNING campaign. Returns `{ done, retryAfter? }` —
 * `retryAfter` is set when stopped by the rate limiter so the caller can
 * re-enqueue with a delay. Runs as system; the campaign's org is the boundary.
 */
export async function dispatchCampaignBatch(
  campaignId: string,
): Promise<{ done: boolean; retryAfter?: number }> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { done: true };
  if (campaign.status !== "RUNNING") return { done: true };

  const channel = campaign.channel as ChannelKey;
  const creds = await resolveChannelCredentials(campaign.organizationId, channel);
  if (!creds) {
    await pause(campaignId);
    return { done: true };
  }

  const org = await prisma.organization.findUnique({
    where: { id: campaign.organizationId },
    select: { plan: true },
  });
  const quota = planConfig((org?.plan ?? "STANDARD") as PlanKey).dispatchQuotaPerMonth;
  const sentThisMonth = await prisma.campaignRecipient.count({
    where: {
      organizationId: campaign.organizationId,
      status: { in: ["SENT", "DELIVERED", "READ"] },
      sentAt: { gte: startOfMonth() },
    },
  });
  const remaining = quota - sentThisMonth;
  if (remaining <= 0) {
    await pause(campaignId);
    return { done: true };
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    take: Math.min(BATCH, remaining),
  });
  if (recipients.length === 0) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "DONE" } });
    return { done: true };
  }

  const contacts = await prisma.contact.findMany({
    where: { id: { in: recipients.map((r) => r.contactId) } },
    select: { id: true, name: true, phone: true, email: true, company: { select: { name: true } } },
  });
  const cmap = new Map(contacts.map((c) => [c.id, c]));

  const template = campaign.templateId
    ? await prisma.messageTemplate.findUnique({ where: { id: campaign.templateId } })
    : null;
  const body = template?.body ?? "";
  const subject = template?.subject ?? campaign.name;
  const targetField = CHANNEL_META[channel].target;
  const adapter = getChannelAdapter(channel);

  const rate = RATE[channel];
  const limiter = makeRateLimiter(`dispatch:${channel}`, rate.limit, rate.windowSec);

  for (const r of recipients) {
    if (limiter) {
      const { success } = await limiter.limit(`${campaign.organizationId}:${channel}`);
      if (!success) {
        // Hit the throttle — stop and let the caller retry shortly.
        return { done: false, retryAfter: rate.windowSec };
      }
    }

    const contact = cmap.get(r.contactId);
    const to = targetField === "phone" ? contact?.phone : contact?.email;
    if (!to) {
      await prisma.campaignRecipient.update({
        where: { id: r.id },
        data: { status: "FAILED", error: "Contato sem destino para o canal." },
      });
      continue;
    }

    const text = renderTemplate(body, {
      nome: contact?.name ?? "",
      empresa: contact?.company?.name ?? "",
    });
    // LGPD: every marketing email carries an unsubscribe link.
    const messageBody =
      channel === "EMAIL"
        ? `${text}<hr style="margin-top:24px"/><p style="font-size:12px;color:#888">Não quer mais receber? <a href="${unsubscribeUrl(r.contactId)}">Descadastre-se aqui</a>.</p>`
        : text;

    const result = await adapter.send(creds.credentials, {
      to,
      body: messageBody,
      subject,
      from: creds.from,
    });

    await prisma.campaignRecipient.update({
      where: { id: r.id },
      data: {
        status: result.ok ? "SENT" : "FAILED",
        providerMessageId: result.providerMessageId ?? null,
        error: result.ok ? null : result.error ?? "Falha no envio",
        sentAt: result.ok ? new Date() : null,
      },
    });
  }

  const pending = await prisma.campaignRecipient.count({
    where: { campaignId, status: "PENDING" },
  });
  if (pending === 0) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "DONE" } });
    return { done: true };
  }
  return { done: false };
}

/** Run a campaign to completion in-process (dev / no queue). */
export async function dispatchCampaignToCompletion(campaignId: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const { done } = await dispatchCampaignBatch(campaignId);
    if (done) return;
  }
}
