import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type TeamChatSummary = {
  id: string;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  otherUserId: string | null;
  name: string | null;
  email: string;
};

/** The team chats the user participates in, with the other member's info. */
export async function listTeamChats(
  organizationId: string,
  userId: string,
): Promise<TeamChatSummary[]> {
  const db = tenantDb(organizationId);
  const chats = await db.teamChat.findMany({
    where: { participants: { some: { userId } } },
    include: {
      participants: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  return chats.map((chat) => {
    const mine = chat.participants.find((p) => p.userId === userId);
    const other = chat.participants.find((p) => p.userId !== userId)?.user;
    return {
      id: chat.id,
      lastMessageAt: chat.lastMessageAt,
      lastMessagePreview: chat.lastMessagePreview,
      unreadCount: mine?.unreadCount ?? 0,
      otherUserId: other?.id ?? null,
      name: other?.name ?? null,
      email: other?.email ?? "",
    };
  });
}

/** Whether the user is a participant of the chat (and it belongs to the org). */
export async function isChatParticipant(
  organizationId: string,
  chatId: string,
  userId: string,
): Promise<boolean> {
  const db = tenantDb(organizationId);
  const chat = await db.teamChat.findFirst({
    where: { id: chatId, participants: { some: { userId } } },
    select: { id: true },
  });
  return chat != null;
}

/** Messages of a chat — only if the requester participates in it. */
export async function listTeamChatMessages(
  organizationId: string,
  chatId: string,
  userId: string,
) {
  if (!(await isChatParticipant(organizationId, chatId, userId))) return [];
  const db = tenantDb(organizationId);
  return db.teamChatMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      chatId: true,
      senderId: true,
      body: true,
      attachmentType: true,
      attachmentId: true,
      createdAt: true,
    },
  });
}

/** Stable key for the 1:1 chat between two users in an org. */
function directKey(organizationId: string, a: string, b: string): string {
  return `${organizationId}:${[a, b].sort().join(":")}`;
}

/** Get (or atomically create) the 1:1 chat between two users. The unique
 * `dmKey` makes the upsert race-free — concurrent calls converge on one chat. */
export async function getOrCreateDirectChat(
  organizationId: string,
  userId1: string,
  userId2: string,
): Promise<string> {
  const db = tenantDb(organizationId);
  const dmKey = directKey(organizationId, userId1, userId2);
  const chat = await db.teamChat.upsert({
    where: { dmKey },
    update: {},
    create: {
      organizationId,
      dmKey,
      participants: {
        create: [
          { organizationId, userId: userId1 },
          { organizationId, userId: userId2 },
        ],
      },
    },
    select: { id: true },
  });
  return chat.id;
}
