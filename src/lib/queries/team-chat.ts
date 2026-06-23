import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";

export type TeamChatFolderRow = { id: string; name: string };

/** The org's team-chat folders (shared, like the WhatsApp inbox folders). */
export async function listTeamChatFolders(organizationId: string): Promise<TeamChatFolderRow[]> {
  const db = tenantDb(organizationId);
  return db.teamChatFolder.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
}

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  teamFolderId: string | null;
  teamPinned: boolean;
};

/** Org members for the team-chat sidebar, with their avatar, folder + pin
 * state. Pinned members first. */
export async function listTeamMembers(organizationId: string): Promise<TeamMember[]> {
  const memberships = await prisma.membership.findMany({
    where: { organizationId },
    orderBy: [{ teamPinned: "desc" }, { createdAt: "asc" }],
    select: {
      userId: true,
      role: true,
      teamFolderId: true,
      teamPinned: true,
      user: { select: { name: true, email: true, profile: { select: { avatarUrl: true } } } },
    },
  });
  return memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    avatarUrl: m.user.profile?.avatarUrl ?? null,
    teamFolderId: m.teamFolderId,
    teamPinned: m.teamPinned,
  }));
}

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
      attachmentLabel: true,
      attachmentHref: true,
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

// --------------------------------------------------------------- Attachments

export type AttachKind = "TASK" | "CONTACT" | "COMPANY" | "OPP" | "LEAD";
export type AttachOption = { id: string; label: string; sublabel: string | null };

/** Search the org's entities of a given kind for the attachment picker. */
export async function searchAttachables(
  organizationId: string,
  kind: AttachKind,
  q: string,
): Promise<AttachOption[]> {
  const db = tenantDb(organizationId);
  const term = q.trim();
  const c = term ? { contains: term, mode: "insensitive" as const } : undefined;
  const take = 20;
  switch (kind) {
    case "TASK": {
      const rows = await db.task.findMany({
        where: c ? { title: c } : {},
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, title: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.title, sublabel: null }));
    }
    case "CONTACT": {
      const rows = await db.contact.findMany({
        where: c ? { OR: [{ name: c }, { email: c }] } : {},
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, name: true, email: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.name, sublabel: r.email }));
    }
    case "COMPANY": {
      const rows = await db.company.findMany({
        where: c ? { OR: [{ name: c }, { cnpj: c }] } : {},
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, name: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.name, sublabel: null }));
    }
    case "OPP": {
      const rows = await db.opportunity.findMany({
        where: c ? { OR: [{ title: c }, { code: c }] } : {},
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, title: true, code: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.code ? `${r.code} · ${r.title}` : r.title, sublabel: null }));
    }
    case "LEAD": {
      const rows = await db.extractedLead.findMany({
        where: c ? { OR: [{ name: c }, { phone: c }] } : {},
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, name: true, phone: true, segment: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.name || r.phone || "Lead", sublabel: r.segment ?? r.phone }));
    }
    default:
      return [];
  }
}

// ------------------------------------------------------------- Member info

export type TeamMemberInfo = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  position: string | null;
  phone: string | null;
  role: string;
  tasks: { id: string; title: string; dueDate: Date | null }[];
  opportunities: { id: string; code: string | null; title: string; value: number; stageName: string | null }[];
};

/** Profile + open work of a team member, for the chat's info panel. */
export async function getTeamMemberInfo(
  organizationId: string,
  userId: string,
): Promise<TeamMemberInfo | null> {
  const membership = await prisma.membership.findFirst({
    where: { organizationId, userId },
    select: {
      role: true,
      user: {
        select: {
          name: true,
          email: true,
          profile: { select: { avatarUrl: true, position: true, phone: true } },
        },
      },
    },
  });
  if (!membership) return null;

  const db = tenantDb(organizationId);
  const [tasks, opps] = await Promise.all([
    db.task.findMany({
      where: { assignedToId: userId, doneAt: null },
      orderBy: [{ dueDate: "asc" }],
      take: 20,
      select: { id: true, title: true, dueDate: true },
    }),
    db.opportunity.findMany({
      where: { ownerId: userId, status: "OPEN" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, code: true, title: true, value: true, stage: { select: { name: true } } },
    }),
  ]);

  return {
    userId,
    name: membership.user.name,
    email: membership.user.email,
    avatarUrl: membership.user.profile?.avatarUrl ?? null,
    position: membership.user.profile?.position ?? null,
    phone: membership.user.profile?.phone ?? null,
    role: membership.role,
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate })),
    opportunities: opps.map((o) => ({
      id: o.id,
      code: o.code,
      title: o.title,
      value: Number(o.value),
      stageName: o.stage?.name ?? null,
    })),
  };
}
