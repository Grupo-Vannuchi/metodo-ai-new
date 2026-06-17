import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/** Conversations for the inbox list, most-recent first. */
export async function listConversations(organizationId: string) {
  const db = tenantDb(organizationId);
  return db.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    select: {
      id: true,
      remoteJid: true,
      name: true,
      lastMessagePreview: true,
      lastMessageAt: true,
      unreadCount: true,
    },
  });
}

/** A single conversation (scoped). */
export async function getConversation(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  return db.conversation.findFirst({
    where: { id },
    select: { id: true, remoteJid: true, name: true },
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
      status: true,
      timestamp: true,
    },
  });
}
