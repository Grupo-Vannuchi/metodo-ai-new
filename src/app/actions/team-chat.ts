"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TeamChatAttachmentType } from "@prisma/client";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { getOrCreateDirectChat, isChatParticipant } from "@/lib/queries/team-chat";
import { resolveAttachment } from "@/lib/attachables";
import { deleteMedia } from "@/lib/storage/blob";

type TeamReaction = { emoji: string; userId: string };

export type TeamChatResult =
  | { ok: true; chatId: string }
  | { ok: false; error: "unauthorized" | "invalid" | "forbidden" | "unknown" };

const sendSchema = z
  .object({
    chatId: z.string().trim().min(1).optional(),
    targetUserId: z.string().trim().min(1).optional(),
    body: z.string().trim().max(4000).optional(),
    attachmentType: z.nativeEnum(TeamChatAttachmentType).optional(),
    attachmentId: z.string().trim().min(1).max(64).optional(),
    replyToId: z.string().trim().min(1).max(40).optional(),
    mentions: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  })
  .refine((d) => Boolean(d.chatId || d.targetUserId), { message: "chat target required" })
  // Either text or an attachment (both ids must come together).
  .refine((d) => Boolean(d.body) || Boolean(d.attachmentType && d.attachmentId), { message: "empty message" });

export async function sendTeamMessage(input: unknown): Promise<TeamChatResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { chatId: inputChatId, targetUserId, body, attachmentType, attachmentId, replyToId, mentions } = parsed.data;

  try {
    const db = tenantDb(ctx.organizationId);

    let chatId = inputChatId;
    if (!chatId && targetUserId) {
      // The target must be a member of the caller's org.
      const member = await prisma.membership.findFirst({
        where: { organizationId: ctx.organizationId, userId: targetUserId },
        select: { userId: true },
      });
      if (!member) return { ok: false, error: "forbidden" };
      chatId = await getOrCreateDirectChat(ctx.organizationId, ctx.userId, targetUserId);
    }
    if (!chatId) return { ok: false, error: "invalid" };

    // The sender must participate in the chat.
    if (!(await isChatParticipant(ctx.organizationId, chatId, ctx.userId))) {
      return { ok: false, error: "forbidden" };
    }

    // Resolve the attachment (must belong to the org); drop it if not found.
    let attachment: { label: string; href: string } | null = null;
    if (attachmentType && attachmentId) {
      attachment = await resolveAttachment(db, attachmentType, attachmentId);
      if (!attachment) return { ok: false, error: "invalid" };
    }

    // Reply must point to a message in this same chat (else drop it).
    let validReplyToId: string | null = null;
    if (replyToId) {
      const rep = await db.teamChatMessage.findFirst({ where: { id: replyToId, chatId }, select: { id: true } });
      validReplyToId = rep?.id ?? null;
    }

    // Mentions: keep only real participants of this chat.
    let mentionedIds: string[] = [];
    if (mentions && mentions.length > 0) {
      const parts = await db.teamChatParticipant.findMany({
        where: { chatId, userId: { in: mentions } },
        select: { userId: true },
      });
      mentionedIds = parts.map((p) => p.userId).filter((id) => id !== ctx.userId);
    }

    const text = body ?? "";
    await db.teamChatMessage.create({
      data: {
        organizationId: ctx.organizationId,
        chatId,
        senderId: ctx.userId,
        body: text,
        attachmentType: attachment ? attachmentType : null,
        attachmentId: attachment ? attachmentId : null,
        attachmentLabel: attachment?.label ?? null,
        attachmentHref: attachment?.href ?? null,
        replyToId: validReplyToId,
        mentions: mentionedIds,
      },
    });
    await db.teamChat.updateMany({
      where: { id: chatId },
      data: { lastMessageAt: new Date(), lastMessagePreview: text || attachment?.label || null },
    });
    await db.teamChatParticipant.updateMany({
      where: { chatId, userId: { not: ctx.userId } },
      data: { unreadCount: { increment: 1 } },
    });

    // Notify the other participants when something was shared.
    if (attachment && attachmentType) {
      const others = await db.teamChatParticipant.findMany({
        where: { chatId, userId: { not: ctx.userId } },
        select: { userId: true },
      });
      if (others.length > 0) {
        await db.notification.createMany({
          data: others.map((o) => ({
            organizationId: ctx.organizationId,
            userId: o.userId,
            type: "TEAM_ATTACHMENT",
            data: { actor: ctx.user.name, attachmentType },
            link: `/app/inbox?mode=team&chat=${chatId}`,
          })),
        });
      }
    }

    // Notify @mentioned participants.
    if (mentionedIds.length > 0) {
      await db.notification.createMany({
        data: mentionedIds.map((uid) => ({
          organizationId: ctx.organizationId,
          userId: uid,
          type: "TEAM_MENTION",
          data: { actor: ctx.user.name, preview: text.slice(0, 120) },
          link: `/app/inbox?mode=team&chat=${chatId}`,
        })),
      });
    }

    revalidatePath("/app/inbox");
    return { ok: true, chatId };
  } catch (error) {
    console.error("Failed to send team message", error);
    return { ok: false, error: "unknown" };
  }
}

export async function markTeamChatRead(chatId: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    // Scoped to the caller's own participant row (org-injected by tenantDb).
    await db.teamChatParticipant.updateMany({
      where: { chatId, userId: ctx.userId },
      data: { unreadCount: 0 },
    });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to mark team chat read", error);
    return { ok: false };
  }
}

/** Toggle the caller's emoji reaction on a team message. */
export async function reactToTeamMessage(messageId: string, emoji: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    const msg = await db.teamChatMessage.findFirst({
      where: { id: messageId },
      select: { id: true, chatId: true, reactions: true },
    });
    if (!msg) return { ok: false };
    if (!(await isChatParticipant(ctx.organizationId, msg.chatId, ctx.userId))) return { ok: false };

    const list: TeamReaction[] = Array.isArray(msg.reactions)
      ? (msg.reactions.filter((r) => r && typeof (r as TeamReaction).emoji === "string") as TeamReaction[])
      : [];
    const mine = list.find((r) => r.userId === ctx.userId);
    const rest = list.filter((r) => r.userId !== ctx.userId);
    const next = mine?.emoji === emoji ? rest : [...rest, { emoji, userId: ctx.userId }];

    await db.teamChatMessage.updateMany({ where: { id: messageId }, data: { reactions: next } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to react to team message", error);
    return { ok: false };
  }
}

/** Edit your own team message (marks it edited). */
export async function editTeamMessage(messageId: string, body: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  const text = body.trim();
  if (!text || text.length > 4000) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    const res = await db.teamChatMessage.updateMany({
      where: { id: messageId, senderId: ctx.userId, deletedAt: null },
      data: { body: text, editedAt: new Date() },
    });
    if (res.count === 0) return { ok: false };
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to edit team message", error);
    return { ok: false };
  }
}

const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  memberIds: z.array(z.string().trim().min(1).max(40)).min(1).max(50),
});

/** Create a group channel with the caller + the picked members. */
export async function createChannel(input: unknown): Promise<TeamChatResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = createChannelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { name, memberIds } = parsed.data;
  try {
    // Keep only real org members; always include the creator.
    const members = await prisma.membership.findMany({
      where: { organizationId: ctx.organizationId, userId: { in: memberIds } },
      select: { userId: true },
    });
    const ids = new Set(members.map((m) => m.userId));
    ids.add(ctx.userId);

    const chat = await prisma.teamChat.create({
      data: {
        organizationId: ctx.organizationId,
        name,
        isGroup: true,
        createdById: ctx.userId,
        lastMessageAt: new Date(),
        participants: { create: [...ids].map((uid) => ({ organizationId: ctx.organizationId, userId: uid })) },
      },
      select: { id: true },
    });

    const others = [...ids].filter((id) => id !== ctx.userId);
    if (others.length > 0) {
      await prisma.notification.createMany({
        data: others.map((uid) => ({
          organizationId: ctx.organizationId,
          userId: uid,
          type: "TEAM_CHANNEL",
          data: { actor: ctx.user.name, channel: name },
          link: `/app/inbox?mode=team&chat=${chat.id}`,
        })),
      });
    }
    revalidatePath("/app/inbox");
    return { ok: true, chatId: chat.id };
  } catch (error) {
    console.error("Failed to create channel", error);
    return { ok: false, error: "unknown" };
  }
}

/** Rename a channel (any participant). */
export async function renameChannel(chatId: string, name: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  const clean = name.trim().slice(0, 80);
  if (!clean) return { ok: false };
  try {
    if (!(await isChatParticipant(ctx.organizationId, chatId, ctx.userId))) return { ok: false };
    const db = tenantDb(ctx.organizationId);
    await db.teamChat.updateMany({ where: { id: chatId, isGroup: true }, data: { name: clean } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to rename channel", error);
    return { ok: false };
  }
}

/** Add members to a channel (any participant). */
export async function addChannelMembers(chatId: string, memberIds: string[]): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    if (!(await isChatParticipant(ctx.organizationId, chatId, ctx.userId))) return { ok: false };
    const chat = await prisma.teamChat.findFirst({ where: { id: chatId, isGroup: true }, select: { id: true, name: true } });
    if (!chat) return { ok: false };
    const members = await prisma.membership.findMany({
      where: { organizationId: ctx.organizationId, userId: { in: memberIds.slice(0, 50) } },
      select: { userId: true },
    });
    for (const m of members) {
      await prisma.teamChatParticipant.upsert({
        where: { chatId_userId: { chatId, userId: m.userId } },
        create: { organizationId: ctx.organizationId, chatId, userId: m.userId },
        update: {},
      });
    }
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to add channel members", error);
    return { ok: false };
  }
}

/** Leave a channel (removes the caller's participation). */
export async function leaveChannel(chatId: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    await db.teamChatParticipant.deleteMany({ where: { chatId, userId: ctx.userId } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to leave channel", error);
    return { ok: false };
  }
}

/** Soft-delete your own team message (clears content + attachments). */
export async function deleteTeamMessage(messageId: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    const msg = await db.teamChatMessage.findFirst({
      where: { id: messageId, senderId: ctx.userId },
      select: { id: true, fileUrl: true },
    });
    if (!msg) return { ok: false };
    if (msg.fileUrl) await deleteMedia(msg.fileUrl).catch(() => {});
    await db.teamChatMessage.updateMany({
      where: { id: messageId, senderId: ctx.userId },
      data: {
        deletedAt: new Date(),
        body: "",
        attachmentType: null,
        attachmentId: null,
        attachmentLabel: null,
        attachmentHref: null,
        fileUrl: null,
        fileName: null,
        fileMime: null,
        fileSize: null,
        reactions: [],
      },
    });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete team message", error);
    return { ok: false };
  }
}
