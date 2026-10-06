import "server-only";
import type { EmailRecipientStatus } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { LIMITS } from "@/config/limits";
import { getResendConnection } from "@/lib/email-broadcast/connection";
import type { ComposerOptions, PickedTarget } from "@/lib/email-broadcast/types";

const PROBLEM_STATUSES: EmailRecipientStatus[] = ["BOUNCED", "COMPLAINED", "FAILED"];
const HAS_EMAIL = { contains: "@" } as const;
/** A SENDING broadcast with no heartbeat for this long gets the "Resume" button. */
const STALE_MS = 2 * 60 * 1000;

export function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Addresses accepted by Resend this month (the E-mail quota; Campaigns has its own). */
export function countEmailsSentThisMonth(organizationId: string): Promise<number> {
  return tenantDb(organizationId).emailBroadcastRecipient.count({
    where: { sentAt: { gte: monthStart() } },
  });
}

export async function listEmailBroadcasts(organizationId: string) {
  const db = tenantDb(organizationId);
  const rows = await db.emailBroadcast.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, subject: true, status: true, pausedReason: true, startedAt: true, updatedAt: true },
  });
  if (rows.length === 0) return [];

  const grouped = await db.emailBroadcastRecipient.groupBy({
    by: ["broadcastId", "status"],
    where: { broadcastId: { in: rows.map((r) => r.id) } },
    _count: { _all: true },
  });
  const tally = new Map<string, { total: number; delivered: number; problems: number }>();
  for (const g of grouped) {
    const t = tally.get(g.broadcastId) ?? { total: 0, delivered: 0, problems: 0 };
    t.total += g._count._all;
    if (g.status === "DELIVERED") t.delivered += g._count._all;
    if (PROBLEM_STATUSES.includes(g.status)) t.problems += g._count._all;
    tally.set(g.broadcastId, t);
  }
  return rows.map((r) => ({ ...r, ...(tally.get(r.id) ?? { total: 0, delivered: 0, problems: 0 }) }));
}

export function getEmailBroadcast(organizationId: string, id: string) {
  return tenantDb(organizationId).emailBroadcast.findFirst({
    where: { id },
    select: {
      id: true,
      subject: true,
      html: true,
      fromName: true,
      replyTo: true,
      audience: true,
      stats: true,
      status: true,
      pausedReason: true,
      lastError: true,
      startedAt: true,
      finishedAt: true,
      lastDispatchAt: true,
    },
  });
}

export type ReportFilter = "all" | "queued" | "sent" | "delivered" | "problems";

const FILTER_STATUSES: Record<Exclude<ReportFilter, "all">, EmailRecipientStatus[]> = {
  queued: ["QUEUED"],
  sent: ["SENT"],
  delivered: ["DELIVERED"],
  problems: PROBLEM_STATUSES,
};

/** Status counts, the first 200 recipients for the filter, and whether a
 * stalled send may be resumed (computed here, not in the component). */
export async function getEmailBroadcastReport(organizationId: string, id: string, filter: ReportFilter) {
  const db = tenantDb(organizationId);
  const [grouped, recipients, b] = await Promise.all([
    db.emailBroadcastRecipient.groupBy({ by: ["status"], where: { broadcastId: id }, _count: { _all: true } }),
    db.emailBroadcastRecipient.findMany({
      where: { broadcastId: id, ...(filter === "all" ? {} : { status: { in: FILTER_STATUSES[filter] } }) },
      orderBy: { email: "asc" },
      take: 200,
      select: { id: true, email: true, name: true, sources: true, status: true, error: true, updatedAt: true },
    }),
    db.emailBroadcast.findFirst({ where: { id }, select: { status: true, startedAt: true, lastDispatchAt: true } }),
  ]);

  const counts: Record<EmailRecipientStatus, number> = {
    QUEUED: 0,
    SENT: 0,
    DELIVERED: 0,
    BOUNCED: 0,
    COMPLAINED: 0,
    FAILED: 0,
  };
  for (const g of grouped) counts[g.status] = g._count._all;

  const now = Date.now();
  const stalled =
    b?.status === "SENDING" &&
    !!b.startedAt &&
    now - b.startedAt.getTime() > STALE_MS &&
    (!b.lastDispatchAt || now - b.lastDispatchAt.getTime() > STALE_MS);

  return { counts, recipients, canResume: b?.status === "PAUSED" || stalled };
}

/** Chips of the recipient picker, each with how many addresses it holds. */
export async function emailComposerOptions(organizationId: string): Promise<ComposerOptions> {
  const db = tenantDb(organizationId);
  const [contacts, contactFolders, companyFolders, companyGroups] = await Promise.all([
    db.contact.findMany({ where: { email: HAS_EMAIL, optedOut: false }, select: { tags: true, folderId: true } }),
    db.contactFolder.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
    db.companyFolder.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
    db.company.groupBy({ by: ["folderId"], where: { email: HAS_EMAIL }, _count: { _all: true } }),
  ]);

  const tagCount = new Map<string, number>();
  const contactFolderCount = new Map<string, number>();
  for (const c of contacts) {
    for (const tag of c.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    if (c.folderId) contactFolderCount.set(c.folderId, (contactFolderCount.get(c.folderId) ?? 0) + 1);
  }
  const companyFolderCount = new Map<string, number>();
  for (const g of companyGroups) if (g.folderId) companyFolderCount.set(g.folderId, g._count._all);

  return {
    contactCount: contacts.length,
    tags: [...tagCount].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    contactFolders: contactFolders.map((f) => ({ ...f, count: contactFolderCount.get(f.id) ?? 0 })),
    companyCount: companyGroups.reduce((n, g) => n + g._count._all, 0),
    companyFolders: companyFolders.map((f) => ({ ...f, count: companyFolderCount.get(f.id) ?? 0 })),
  };
}

/** Everything the composer page needs besides the draft itself. */
export async function emailComposerData(organizationId: string) {
  const [options, conn, used] = await Promise.all([
    emailComposerOptions(organizationId),
    getResendConnection(organizationId),
    countEmailsSentThisMonth(organizationId),
  ]);
  return {
    options,
    fromEmail: conn?.fromEmail ?? null,
    quota: { used, limit: LIMITS.emailBroadcastQuotaPerMonth },
  };
}

/** Name/e-mail search for the "E-mails avulsos" field (contacts first). */
export async function searchEmailTargets(organizationId: string, q: string): Promise<PickedTarget[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const db = tenantDb(organizationId);
  const match = { contains: term, mode: "insensitive" as const };
  const [contacts, companies] = await Promise.all([
    db.contact.findMany({
      where: { email: HAS_EMAIL, OR: [{ name: match }, { email: match }] },
      orderBy: { name: "asc" },
      take: 6,
      select: { id: true, name: true, email: true },
    }),
    db.company.findMany({
      where: { email: HAS_EMAIL, OR: [{ name: match }, { email: match }] },
      orderBy: { name: "asc" },
      take: 4,
      select: { id: true, name: true, email: true },
    }),
  ]);
  return [
    ...contacts.map((c) => ({ kind: "contact" as const, id: c.id, name: c.name, email: c.email ?? "" })),
    ...companies.map((c) => ({ kind: "company" as const, id: c.id, name: c.name, email: c.email ?? "" })),
  ];
}

/** Chips for the contacts/companies a draft picked by search. */
export async function pickedTargets(
  organizationId: string,
  contactIds: string[],
  companyIds: string[],
): Promise<PickedTarget[]> {
  const db = tenantDb(organizationId);
  const [contacts, companies] = await Promise.all([
    contactIds.length
      ? db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    companyIds.length
      ? db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);
  return [
    ...contacts.map((c) => ({ kind: "contact" as const, id: c.id, name: c.name, email: c.email ?? "" })),
    ...companies.map((c) => ({ kind: "company" as const, id: c.id, name: c.name, email: c.email ?? "" })),
  ];
}
