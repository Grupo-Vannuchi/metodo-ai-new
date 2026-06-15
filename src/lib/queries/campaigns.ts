import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export async function listTemplates(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.messageTemplate.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, channel: true, subject: true },
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
