import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { WHATSAPP_PROVIDERS } from "@/lib/queries/connections";
import { loadEvoCredsById } from "@/lib/integrations/evolution-creds";
import { findContactNames, findGroupInfo, findGroupParticipants } from "@/lib/integrations/evolution-client";
import { withContactNames, type GroupParticipant } from "@/lib/integrations/evolution-groups";
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

/** Every group on the user's own numbers (not only the recent conversations the inbox loads), by name. */
export async function listExportGroups(
  organizationId: string,
  userId: string,
): Promise<{ id: string; name: string }[]> {
  const db = tenantDb(organizationId);
  const ids = await ownedConnIds(db, userId);
  if (ids.length === 0) return [];
  const groups = await db.conversation.findMany({
    where: { isGroup: true, connectionId: { in: ids } },
    take: 1000,
    select: { id: true, name: true, customName: true },
  });
  return groups
    .map((g) => ({ id: g.id, name: g.customName || g.name || "Grupo" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Evolution's contact names per connection id, so one run over many groups of a number fetches the list once. */
export type ContactNamesCache = Map<string, Promise<Map<string, string> | null>>;

/**
 * A group's members as country-coded numbers, with the names Evolution knows
 * (none for a member it has no contact for). `readable` is false when Evolution
 * didn't answer, so callers can tell "couldn't read the group" from "no members
 * with a number".
 */
export async function getGroupMembers(
  organizationId: string,
  conversationId: string,
  userId: string,
  namesCache?: ContactNamesCache,
): Promise<{ title: string; readable: boolean; members: GroupParticipant[] } | null> {
  const db = tenantDb(organizationId);
  const ids = await ownedConnIds(db, userId);
  // Only a group that lives on one of the user's own numbers.
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, isGroup: true, connectionId: { in: ids } },
    select: { remoteJid: true, connectionId: true, name: true, customName: true },
  });
  if (!conv) return null;

  const title = conv.customName || conv.name || "Grupo";
  const creds = await loadEvoCredsById(conv.connectionId);
  if (!creds) return { title, readable: false, members: [] };
  // /group/participants carries the names; findGroupInfos (numbers only) stays as the fallback.
  let members =
    (await findGroupParticipants(creds, conv.remoteJid)) ??
    (await findGroupInfo(creds, conv.remoteJid))?.participants ??
    null;
  if (!members) return { title, readable: false, members: [] };
  if (members.some((m) => !m.name)) {
    let pending = namesCache?.get(conv.connectionId);
    if (!pending) {
      pending = findContactNames(creds);
      namesCache?.set(conv.connectionId, pending);
    }
    const names = await pending;
    if (names) members = withContactNames(members, names);
  }
  return { title, readable: true, members };
}

/** A group's members as export rows; `readable` as in getGroupMembers. */
export async function getGroupRows(
  organizationId: string,
  conversationId: string,
  userId: string,
): Promise<{ title: string; readable: boolean; rows: ExportRow[] } | null> {
  const group = await getGroupMembers(organizationId, conversationId, userId);
  if (!group) return null;
  const rows: ExportRow[] = group.members.map((p) => {
    const number = formatBrPhone(p.number) || p.number;
    const name = p.name ?? number;
    return { name: p.admin ? `${name} (admin)` : name, number };
  });
  return { title: group.title, readable: group.readable, rows };
}
