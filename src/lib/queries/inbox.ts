import "server-only";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";

/** Conversations for the inbox list (most-recent first), enriched with the
 * linked contact and the assigned member's names. */
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
      assignedToId: true,
    },
  });

  const contactIds = [...new Set(convos.map((c) => c.contactId).filter(Boolean))] as string[];
  const userIds = [...new Set(convos.map((c) => c.assignedToId).filter(Boolean))] as string[];

  const [contacts, users] = await Promise.all([
    contactIds.length
      ? db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const cMap = new Map(contacts.map((c) => [c.id, c.name]));
  const uMap = new Map(users.map((u) => [u.id, u.name]));

  return convos.map((c) => ({
    id: c.id,
    remoteJid: c.remoteJid,
    name: c.name,
    lastMessagePreview: c.lastMessagePreview,
    lastMessageAt: c.lastMessageAt,
    unreadCount: c.unreadCount,
    contactId: c.contactId,
    contactName: c.contactId ? cMap.get(c.contactId) ?? null : null,
    assignedToId: c.assignedToId,
    assignedToName: c.assignedToId ? uMap.get(c.assignedToId) ?? null : null,
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

/** Total unread messages across the org's conversations (for the nav badge). */
export async function countUnread(organizationId: string): Promise<number> {
  const db = tenantDb(organizationId);
  const agg = await db.conversation.aggregate({ _sum: { unreadCount: true } });
  return agg._sum.unreadCount ?? 0;
}
