import "server-only";
import { prisma } from "@/lib/prisma";
import { getChannelAdapter } from "@/lib/integrations/channels";
import { CHANNEL_META, type ChannelKey } from "@/lib/integrations/channels/meta";
import type { ChannelCredentials } from "@/lib/integrations/channels/types";
import { decryptCredentials } from "@/lib/integrations/crypto";
import { makeRateLimiter } from "@/lib/ratelimit";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import { planConfig, type PlanKey } from "@/config/plans";

/** Per-channel sliding-window rate limit (events per window) — a hard ceiling. */
const RATE: Record<ChannelKey, { limit: number; windowSec: number }> = {
  WHATSAPP_EVOLUTION: { limit: 20, windowSec: 60 },
  WHATSAPP_CLOUD: { limit: 60, windowSec: 60 },
  EMAIL: { limit: 100, windowSec: 60 },
};

/**
 * Anti-spam pacing per channel. WhatsApp bans numbers that send identical
 * messages in quick succession, so we send a tiny batch per invocation and
 * space the next one by a randomized gap (jitter) — a human-like cadence,
 * ~1 msg/min. Email has no such ban risk, so it stays fast. `maxGapSec === 0`
 * means "no throttle" (send the whole batch, re-enqueue immediately).
 */
const THROTTLE: Record<ChannelKey, { perBatch: number; minGapSec: number; maxGapSec: number }> = {
  WHATSAPP_EVOLUTION: { perBatch: 1, minGapSec: 30, maxGapSec: 60 },
  WHATSAPP_CLOUD: { perBatch: 1, minGapSec: 30, maxGapSec: 60 },
  EMAIL: { perBatch: 25, minGapSec: 0, maxGapSec: 0 },
};

const randInt = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

/**
 * Resolve spintax: `{a|b|c}` picks one option at random (nesting supported).
 * Applied per recipient so identical templates yield varied messages — the
 * other half of WhatsApp's spam heuristic (identical text). `{{nome}}` and other
 * double-brace variables are left untouched (they contain no `|`).
 */
export function renderSpintax(text: string): string {
  const re = /\{([^{}]*\|[^{}]*)\}/;
  let out = text;
  for (let guard = 0; guard < 200 && re.test(out); guard++) {
    out = out.replace(re, (_m, group: string) => {
      const options = group.split("|");
      return options[randInt(0, options.length - 1)] ?? "";
    });
  }
  return out;
}

export type ChannelCreds = { credentials: ChannelCredentials; from?: string };

/**
 * Resolve the credentials a channel sends with — always the tenant's own
 * connection. There are no platform-managed defaults: every organization
 * connects its own accounts (email, WhatsApp, etc.).
 */
export async function resolveChannelCredentials(
  organizationId: string,
  channel: ChannelKey,
): Promise<ChannelCreds | null> {
  const provider = CHANNEL_META[channel].connectionProvider;

  const conn = await prisma.integrationConnection.findFirst({
    where: { organizationId, provider },
    orderBy: { createdAt: "desc" },
  });
  if (!conn) return null;
  try {
    const credentials = decryptCredentials(conn.credentialsEnc);
    return { credentials, from: credentials.fromEmail };
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

  // Stamp so the per-minute cron doesn't enqueue a second job onto this active,
  // self-throttling chain (which would break the pacing / duplicate sends).
  await prisma.campaign.update({ where: { id: campaignId }, data: { lastDispatchAt: new Date() } });

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
    take: Math.min(THROTTLE[channel].perBatch, remaining),
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

    // Spintax first (varied per recipient), then variable substitution.
    const text = renderTemplate(renderSpintax(body), {
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
  // Pace the next batch with a randomized gap (jitter) for throttled channels.
  const t = THROTTLE[channel];
  const retryAfter = t.maxGapSec > 0 ? randInt(t.minGapSec, t.maxGapSec) : undefined;
  return { done: false, retryAfter };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a campaign to completion in-process (dev / no queue), honoring the
 * per-channel pacing so local sends don't trip WhatsApp's anti-spam. Meant to
 * run in the background (the caller should NOT await it).
 */
export async function dispatchCampaignToCompletion(campaignId: string): Promise<void> {
  for (let i = 0; i < 5000; i++) {
    const { done, retryAfter } = await dispatchCampaignBatch(campaignId);
    if (done) return;
    if (retryAfter) await sleep(retryAfter * 1000);
  }
}
