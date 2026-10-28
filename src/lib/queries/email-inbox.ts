import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { normalizeEmail } from "@/lib/email-broadcast/normalize";
import type { SentToAddress } from "@/lib/email-broadcast/microsoft/inbox-core";

/** At most this many distinct senders are looked up per inbox page. */
const MAX_ADDRESSES = 60;

function distinctEmails(emails: (string | null)[]): string[] {
  const set = new Set<string>();
  for (const e of emails) if (e) set.add(normalizeEmail(e));
  return [...set].slice(0, MAX_ADDRESSES);
}

export type InboxCrmContact = { id: string; name: string; companyName: string | null };

/** CRM contacts whose e-mail matches a sender (case-insensitive); the oldest contact wins. */
export async function crmContactsByEmail(
  organizationId: string,
  emails: (string | null)[],
): Promise<Map<string, InboxCrmContact>> {
  const list = distinctEmails(emails);
  const out = new Map<string, InboxCrmContact>();
  if (list.length === 0) return out;
  const rows = await tenantDb(organizationId).contact.findMany({
    where: { OR: list.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })) },
    select: { id: true, name: true, email: true, company: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  for (const row of rows) {
    const key = row.email ? normalizeEmail(row.email) : null;
    if (key && !out.has(key)) out.set(key, { id: row.id, name: row.name, companyName: row.company?.name ?? null });
  }
  return out;
}

/** Sends of this mailbox channel that went (or may have gone) to these addresses, newest first. */
export async function mailboxSendsTo(
  organizationId: string,
  channel: "MICROSOFT" | "SMTP",
  emails: (string | null)[],
): Promise<SentToAddress[]> {
  const list = distinctEmails(emails);
  if (list.length === 0) return [];
  const rows = await tenantDb(organizationId).emailBroadcastRecipient.findMany({
    where: {
      email: { in: list },
      status: { in: ["SENT", "UNCERTAIN"] },
      sentAt: { not: null },
      broadcast: { channel },
    },
    select: { email: true, sentAt: true, broadcast: { select: { id: true, subject: true } } },
    orderBy: { sentAt: "desc" },
    take: 1000,
  });
  return rows.flatMap((r) =>
    r.sentAt ? [{ email: r.email, broadcastId: r.broadcast.id, subject: r.broadcast.subject, sentAt: r.sentAt }] : [],
  );
}
