import "server-only";
import type { EmailRecipientStatus } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";

/** One mass e-mail the contact was in, for the "E-mails" section of the contact's page. */
export type ContactBroadcastRow = {
  broadcastId: string;
  subject: string;
  status: EmailRecipientStatus;
  /** When it went out (null while it waits in the queue or never went). */
  sentAt: Date | null;
  /** The recipient row's last change: the date shown when it has no sentAt. */
  updatedAt: Date;
};

/**
 * The mass e-mails a contact was in, newest first, at most `limit`. A recipient row points to its contact loosely (no FK:
 * deleting a contact keeps the send history), and a send typed by hand or imported from a spreadsheet has no contactId, so
 * the rows are found by the contact's id OR by its address (stored trimmed and lowercase). One send counts once even when
 * both match. Org-scoped through tenantDb.
 */
export async function listContactBroadcasts(
  organizationId: string,
  contactId: string,
  email: string | null,
  limit = 10,
): Promise<ContactBroadcastRow[]> {
  const address = email?.trim().toLowerCase() || null;
  const rows = await tenantDb(organizationId).emailBroadcastRecipient.findMany({
    where: { OR: [{ contactId }, ...(address ? [{ email: address }] : [])] },
    // The row's last change: a send still in the queue or one that failed has no sentAt, and must not sink below old ones.
    orderBy: { updatedAt: "desc" },
    take: limit * 2,
    select: {
      broadcastId: true,
      status: true,
      sentAt: true,
      updatedAt: true,
      broadcast: { select: { subject: true } },
    },
  });
  const seen = new Set<string>();
  const out: ContactBroadcastRow[] = [];
  for (const r of rows) {
    if (seen.has(r.broadcastId)) continue;
    seen.add(r.broadcastId);
    out.push({ broadcastId: r.broadcastId, subject: r.broadcast.subject, status: r.status, sentAt: r.sentAt, updatedAt: r.updatedAt });
    if (out.length === limit) break;
  }
  return out;
}
