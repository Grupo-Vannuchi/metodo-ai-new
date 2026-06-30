import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { WHATSAPP_PROVIDERS } from "@/lib/queries/connections";

/** Viewer scope: who is asking. Members see only conversations from the numbers
 * they connected; OWNER/ADMIN see all of the org's numbers. */
export type InboxViewer = { userId: string; role: string };

/**
 * WhatsApp connection ids the viewer may see. `null` = no restriction (admin);
 * `[]` = a member who hasn't connected a number (sees nothing).
 */
async function visibleConnectionIds(
  db: ReturnType<typeof tenantDb>,
  viewer: InboxViewer,
): Promise<string[] | null> {
  if (viewer.role !== "MEMBER") return null;
  const conns = await db.integrationConnection.findMany({
    where: { ownerId: viewer.userId, provider: { in: [...WHATSAPP_PROVIDERS] } },
    select: { id: true },
  });
  return conns.map((c) => c.id);
}

/** True when the viewer is allowed to open this conversation. */
export async function canAccessConversation(
  organizationId: string,
  conversationId: string,
  viewer: InboxViewer,
): Promise<boolean> {
  const db = tenantDb(organizationId);
  const conv = await db.conversation.findFirst({
    where: { id: conversationId },
    select: { connectionId: true },
  });
  if (!conv) return false;
  const ids = await visibleConnectionIds(db, viewer);
  return ids === null || ids.includes(conv.connectionId);
}

/** True when the viewer may act on this message's conversation. */
export async function canAccessMessage(
  organizationId: string,
  messageId: string,
  viewer: InboxViewer,
): Promise<boolean> {
  const db = tenantDb(organizationId);
  const msg = await db.message.findFirst({
    where: { id: messageId },
    select: { conversationId: true },
  });
  if (!msg) return false;
  return canAccessConversation(organizationId, msg.conversationId, viewer);
}

/** Conversations for the inbox list (most-recent first), enriched with the
 * linked contact's name. Scoped to the viewer's connected numbers. */
export async function listConversations(organizationId: string, viewer: InboxViewer) {
  const db = tenantDb(organizationId);
  const ids = await visibleConnectionIds(db, viewer);
  if (ids !== null && ids.length === 0) return [];
  const convos = await db.conversation.findMany({
    where: ids ? { connectionId: { in: ids } } : {},
    orderBy: [{ pinned: "desc" }, { lastMessageAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      remoteJid: true,
      isGroup: true,
      name: true,
      customName: true,
      lastMessagePreview: true,
      lastMessageAt: true,
      unreadCount: true,
      contactId: true,
      pinned: true,
      folderId: true,
      avatarUrl: true,
      avatarCheckedAt: true,
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
    isGroup: c.isGroup,
    name: c.name,
    customName: c.customName,
    lastMessagePreview: c.lastMessagePreview,
    lastMessageAt: c.lastMessageAt,
    unreadCount: c.unreadCount,
    contactId: c.contactId,
    contactName: c.contactId ? cMap.get(c.contactId) ?? null : null,
    pinned: c.pinned,
    folderId: c.folderId,
    avatarUrl: c.avatarUrl,
    avatarChecked: c.avatarCheckedAt !== null,
  }));
}

/** Inbox folders for the org, ordered. */
export async function listConversationFolders(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.conversationFolder.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
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
      senderName: true,
      status: true,
      timestamp: true,
      mediaUrl: true,
      mediaMime: true,
      mediaStatus: true,
      mediaName: true,
      mediaDurationSec: true,
      mediaWidth: true,
      mediaHeight: true,
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
      company: { select: { id: true, name: true } },
      opportunities: {
        where: { status: "OPEN" },
        select: { id: true, title: true, value: true, stage: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
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

/** Unread messages across the viewer's conversations (for the nav badge). */
export async function countUnread(organizationId: string, viewer: InboxViewer): Promise<number> {
  const db = tenantDb(organizationId);
  const ids = await visibleConnectionIds(db, viewer);
  if (ids !== null && ids.length === 0) return 0;
  const agg = await db.conversation.aggregate({
    _sum: { unreadCount: true },
    where: ids ? { connectionId: { in: ids } } : {},
  });
  return agg._sum.unreadCount ?? 0;
}
