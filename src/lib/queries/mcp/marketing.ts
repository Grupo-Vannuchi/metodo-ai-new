import "server-only";
import type { CampaignStatus, Channel, EmailBroadcastStatus, EmailChannel, Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";

/**
 * Marketing reads of the MCP server: campaigns and mass e-mails as metadata
 * and recipient counts only — never a template body, the e-mail HTML, the
 * signature, the audience selection, attachments or provider errors.
 */

type Page = { take: number; skip: number };
type Range = { gte?: Date; lt?: Date } | null;

const CAMPAIGN_RECIPIENT_STATUSES = ["PENDING", "SENT", "DELIVERED", "READ", "FAILED"] as const;
const EMAIL_RECIPIENT_STATUSES = [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "BOUNCED",
  "COMPLAINED",
  "FAILED",
  "SENDING",
  "UNCERTAIN",
] as const;

/** `{ total, <STATUS>: n… }` with every status present (0 when none). */
function countsByStatus<S extends string>(
  statuses: readonly S[],
  groups: { status: S; _count: { _all: number } }[],
): { total: number } & Record<S, number> {
  const counts = { total: 0 } as { total: number } & Record<S, number>;
  for (const s of statuses) counts[s] = 0 as never;
  for (const g of groups) {
    counts[g.status] = g._count._all as never;
    counts.total += g._count._all;
  }
  return counts;
}

export async function searchCampaigns(
  organizationId: string,
  a: { status?: CampaignStatus; channel?: Channel; page: Page },
) {
  const db = tenantDb(organizationId);
  const where: Prisma.CampaignWhereInput = { status: a.status, channel: a.channel };
  const [total, rows] = await Promise.all([
    db.campaign.count({ where }),
    db.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...a.page,
      select: {
        id: true,
        name: true,
        channel: true,
        status: true,
        templateId: true,
        startAt: true,
        lastDispatchAt: true,
        createdAt: true,
      },
    }),
  ]);
  const campaignIds = rows.map((c) => c.id);
  const templateIds = [...new Set(rows.map((c) => c.templateId).filter((id): id is string => Boolean(id)))];
  const [groups, templates] = await Promise.all([
    campaignIds.length
      ? db.campaignRecipient.groupBy({
          by: ["campaignId", "status"],
          where: { campaignId: { in: campaignIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    templateIds.length
      ? db.messageTemplate.findMany({ where: { id: { in: templateIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const templateName = new Map(templates.map((t) => [t.id, t.name]));
  return {
    total,
    items: rows.map(({ templateId, ...c }) => ({
      ...c,
      templateName: templateId ? (templateName.get(templateId) ?? null) : null,
      recipients: countsByStatus(
        CAMPAIGN_RECIPIENT_STATUSES,
        groups.filter((g) => g.campaignId === c.id),
      ),
    })),
  };
}

export async function searchEmailBroadcasts(
  organizationId: string,
  a: { status?: EmailBroadcastStatus; channel?: EmailChannel; range: Range; page: Page },
) {
  const db = tenantDb(organizationId);
  const where: Prisma.EmailBroadcastWhereInput = {
    status: a.status,
    channel: a.channel,
    ...(a.range ? { createdAt: a.range } : {}),
  };
  const [total, rows] = await Promise.all([
    db.emailBroadcast.count({ where }),
    db.emailBroadcast.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...a.page,
      select: {
        id: true,
        subject: true,
        channel: true,
        status: true,
        fromName: true,
        fromEmail: true,
        pausedReason: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
      },
    }),
  ]);
  const broadcastIds = rows.map((b) => b.id);
  const groups = broadcastIds.length
    ? await db.emailBroadcastRecipient.groupBy({
        by: ["broadcastId", "status"],
        where: { broadcastId: { in: broadcastIds } },
        _count: { _all: true },
      })
    : [];
  return {
    total,
    items: rows.map((b) => ({
      ...b,
      recipients: countsByStatus(
        EMAIL_RECIPIENT_STATUSES,
        groups.filter((g) => g.broadcastId === b.id),
      ),
    })),
  };
}
