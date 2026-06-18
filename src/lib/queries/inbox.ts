import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/** Conversations for the inbox list (most-recent first), enriched with the
 * linked contact's name. */
export async function listConversations(organizationId: string) {
  const db = tenantDb(organizationId);
  const convos = await db.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    select: {
      id: true,
      remoteJid: true,
      name: true,
      lastMessagePreview: true,
      lastMessageAt: true,
      unreadCount: true,
      contactId: true,
    },
  });

  const contactIds = [...new Set(convos.map((c) => c.contactId).filter(Boolean))] as string[];
  const contacts = contactIds.length
    ? await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })
    : [];
  const cMap = new Map(contacts.map((c) => [c.id, c.name]));

  return convos.map((c) => ({
    id: c.id,
    remoteJid: c.remoteJid,
    name: c.name,
    lastMessagePreview: c.lastMessagePreview,
    lastMessageAt: c.lastMessageAt,
    unreadCount: c.unreadCount,
    contactId: c.contactId,
    contactName: c.contactId ? cMap.get(c.contactId) ?? null : null,
  }));
}

/** Messages of a conversation, oldest first (scoped via organizationId). */
export async function listMessages(organizationId: string, conversationId: string) {
  const db = tenantDb(organizationId);
  return db.message.findMany({
    where: { conversationId },
    orderBy: { timestamp: "asc" },
    take: 200,
    select: {
      id: true,
      direction: true,
      type: true,
      body: true,
      status: true,
      timestamp: true,
    },
  });
}

/** Contact details for the inbox side panel. */
export async function getContactPanel(organizationId: string, contactId: string) {
  const db = tenantDb(organizationId);
  return db.contact.findFirst({
    where: { id: contactId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      tags: true,
      company: { select: { name: true } },
    },
  });
}

/** The conversation linked to a CRM contact, if any (for the contact page). */
export async function getConversationByContact(organizationId: string, contactId: string) {
  const db = tenantDb(organizationId);
  return db.conversation.findFirst({
    where: { contactId },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, lastMessagePreview: true, lastMessageAt: true },
  });
}

/** Total unread messages across the org's conversations (for the nav badge). */
export async function countUnread(organizationId: string): Promise<number> {
  const db = tenantDb(organizationId);
  const agg = await db.conversation.aggregate({ _sum: { unreadCount: true } });
  return agg._sum.unreadCount ?? 0;
}
