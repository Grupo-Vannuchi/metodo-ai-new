"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TeamChatAttachmentType } from "@prisma/client";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { getOrCreateDirectChat, isChatParticipant } from "@/lib/queries/team-chat";
import { resolveAttachment } from "@/lib/attachables";

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
  })
  .refine((d) => Boolean(d.chatId || d.targetUserId), { message: "chat target required" })
  // Either text or an attachment (both ids must come together).
  .refine((d) => Boolean(d.body) || Boolean(d.attachmentType && d.attachmentId), { message: "empty message" });

export async function sendTeamMessage(input: unknown): Promise<TeamChatResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { chatId: inputChatId, targetUserId, body, attachmentType, attachmentId } = parsed.data;

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
