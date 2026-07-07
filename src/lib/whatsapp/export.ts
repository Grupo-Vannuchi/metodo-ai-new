import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { WHATSAPP_PROVIDERS } from "@/lib/queries/connections";
import { loadEvoCredsById } from "@/lib/integrations/evolution-creds";
import { findGroupInfo } from "@/lib/integrations/evolution-client";
import { formatBrPhone } from "@/lib/phone";

/**
 * Data for the WhatsApp inbox exports: the contact list (individual
 * conversations) or a group's members. The file generation itself is the shared
 * tabular exporter in src/lib/export/table.ts. Everything is scoped to the
 * user's OWN connected numbers — exports are per-user, never shared.
 */

export type ExportRow = { name: string; number: string };

/** WhatsApp connection ids the user owns. */
async function ownedConnIds(db: ReturnType<typeof tenantDb>, userId: string): Promise<string[]> {
  const conns = await db.integrationConnection.findMany({
    where: { ownerId: userId, provider: { in: [...WHATSAPP_PROVIDERS] } },
    select: { id: true },
  });
  return conns.map((c) => c.id);
}

/** The user's own individual (non-group) conversations as name + number rows. */
export async function getContactRows(organizationId: string, userId: string): Promise<ExportRow[]> {
  const db = tenantDb(organizationId);
  const ids = await ownedConnIds(db, userId);
  if (ids.length === 0) return [];
  const convos = await db.conversation.findMany({
    where: { isGroup: false, connectionId: { in: ids } },
    orderBy: [{ lastMessageAt: "desc" }],
    take: 5000,
    select: { remoteJid: true, name: true, customName: true, contactId: true },
  });
  const contactIds = [...new Set(convos.map((c) => c.contactId).filter(Boolean))] as string[];
  const contacts = contactIds.length
    ? await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })
    : [];
  const cMap = new Map(contacts.map((c) => [c.id, c.name]));

  return convos.map((c) => {
    const digits = c.remoteJid.split("@")[0] ?? "";
    const number = formatBrPhone(digits) || digits;
    const name = c.customName || (c.contactId ? cMap.get(c.contactId) : null) || c.name || number;
    return { name, number };
  });
}

/** A group's participants as number rows (Evolution gives JIDs, not names). */
export async function getGroupRows(
  organizationId: string,
  conversationId: string,
  userId: string,
): Promise<{ title: string; rows: ExportRow[] } | null> {
  const db = tenantDb(organizationId);
  const ids = await ownedConnIds(db, userId);
  // Only export a group that lives on one of the user's own numbers.
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, isGroup: true, connectionId: { in: ids } },
    select: { remoteJid: true, connectionId: true, name: true, customName: true },
  });
  if (!conv) return null;

  const creds = await loadEvoCredsById(conv.connectionId);
  const info = creds ? await findGroupInfo(creds, conv.remoteJid) : null;
  const title = conv.customName || conv.name || "Grupo";
  const rows: ExportRow[] = (info?.participants ?? []).map((p) => {
    const number = formatBrPhone(p.number) || p.number;
    return { name: p.admin ? `${number} (admin)` : number, number };
  });
  return { title, rows };
}
