"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TeamChatAttachmentType } from "@prisma/client";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { getOrCreateDirectChat, isChatParticipant } from "@/lib/queries/team-chat";

export type TeamChatResult =
  | { ok: true; chatId: string }
  | { ok: false; error: "unauthorized" | "invalid" | "forbidden" | "unknown" };

const sendSchema = z
  .object({
    chatId: z.string().trim().min(1).optional(),
    targetUserId: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).max(4000),
    attachmentType: z.nativeEnum(TeamChatAttachmentType).optional(),
    attachmentId: z.string().trim().min(1).max(64).optional(),
  })
  .refine((d) => Boolean(d.chatId || d.targetUserId), { message: "chatId or targetUserId required" });

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

    await db.teamChatMessage.create({
      data: {
        organizationId: ctx.organizationId,
        chatId,
        senderId: ctx.userId,
        body,
        attachmentType,
        attachmentId,
      },
    });
    await db.teamChat.updateMany({
      where: { id: chatId },
      data: { lastMessageAt: new Date(), lastMessagePreview: body },
    });
    await db.teamChatParticipant.updateMany({
      where: { chatId, userId: { not: ctx.userId } },
      data: { unreadCount: { increment: 1 } },
    });

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
