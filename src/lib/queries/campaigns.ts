import "server-only";
import { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { CHANNEL_META, type ChannelKey } from "@/lib/integrations/channels/meta";

export type AudienceFilter = {
  tags?: string[];
  folderId?: string;
  source?: string;
  stageId?: string;
  oppStatus?: "OPEN" | "WON" | "LOST" | "CANCELED" | "";
  ownerId?: string;
};

/** Build the contact `where` for a campaign's audience: reachable on the
 * channel, never opted out (LGPD), narrowed by the optional segmentation
 * filters (AND). Stage/status/owner match via a linked opportunity. */
export function audienceWhere(channel: ChannelKey, f: AudienceFilter): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput =
    CHANNEL_META[channel].target === "phone" ? { phone: { not: null } } : { email: { not: null } };
  where.optedOut = false;
  if (f.tags && f.tags.length > 0) where.tags = { hasSome: f.tags };
  if (f.folderId) where.folderId = f.folderId;
  if (f.source) where.source = f.source;
  const opp: Prisma.OpportunityWhereInput = {};
  if (f.stageId) opp.stageId = f.stageId;
  if (f.oppStatus) opp.status = f.oppStatus;
  if (f.ownerId) opp.ownerId = f.ownerId;
  if (Object.keys(opp).length > 0) where.opportunities = { some: opp };
  return where;
}

/** Distinct tags and sources across the org's contacts, for the audience
 * filters. */
export async function audienceFacets(organizationId: string) {
  const db = tenantDb(organizationId);
  const rows = await db.contact.findMany({ select: { tags: true, source: true } });
  const tags = new Set<string>();
  const sources = new Set<string>();
  for (const r of rows) {
    for (const tag of r.tags) tags.add(tag);
    if (r.source) sources.add(r.source);
  }
  return { tags: [...tags].sort(), sources: [...sources].sort() };
}

/** Messages actually sent (SENT/DELIVERED/READ) since `since` — for the monthly
 * dispatch quota and the usage panel. */
export function countDispatchedSince(
  organizationId: string,
  since: Date,
): Promise<number> {
  const db = tenantDb(organizationId);
  return db.campaignRecipient.count({
    where: { status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: since } },
  });
}

export async function listTemplates(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.messageTemplate.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, channel: true, subject: true },
  });
}

/** A single template for the edit form. */
export async function getTemplate(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  return db.messageTemplate.findFirst({
    where: { id },
    select: { id: true, channel: true, name: true, subject: true, body: true },
  });
}

/** Minimal template options for the campaign form (filtered client-side by channel). */
export async function templateOptions(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.messageTemplate.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, channel: true },
  });
}

export async function listCampaigns(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.campaign.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      channel: true,
      status: true,
      _count: { select: { recipients: true } },
    },
  });
}

/** A campaign with status counts and its recipients (with contact name). */
export async function getCampaign(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  const campaign = await db.campaign.findFirst({
    where: { id },
    select: { id: true, name: true, channel: true, status: true, templateId: true },
  });
  if (!campaign) return null;

  const grouped = await db.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId: id },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count._all;

  const recipientsRaw = await db.campaignRecipient.findMany({
    where: { campaignId: id },
    orderBy: { id: "asc" },
    take: 200,
    select: { id: true, contactId: true, status: true, error: true, sentAt: true },
  });

  const contacts = await db.contact.findMany({
    where: { id: { in: recipientsRaw.map((r) => r.contactId) } },
    select: { id: true, name: true, phone: true, email: true },
  });
  const cmap = new Map(contacts.map((c) => [c.id, c]));

  const recipients = recipientsRaw.map((r) => {
    const c = cmap.get(r.contactId);
    return {
      id: r.id,
      name: c?.name ?? "—",
      destination: c?.phone ?? c?.email ?? "—",
      status: r.status,
      error: r.error,
      sentAt: r.sentAt,
    };
  });

  return { campaign, counts, recipients };
}
