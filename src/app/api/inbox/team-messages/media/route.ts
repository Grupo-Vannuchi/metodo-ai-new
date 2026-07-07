import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { putMedia } from "@/lib/storage/blob";
import { getOrCreateDirectChat, isChatParticipant } from "@/lib/queries/team-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

/**
 * Send a file (image/document) in a team chat. Uploads to object storage and
 * stores only the metadata + URL on the message (bytes never touch Postgres).
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  let file: File | null = null;
  let chatId = "";
  let targetUserId = "";
  let body = "";
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    chatId = String(form.get("chatId") ?? "");
    targetUserId = String(form.get("targetUserId") ?? "");
    body = String(form.get("body") ?? "").slice(0, 4000);
  } catch {
    /* ignore */
  }
  if (!file || (!chatId && !targetUserId)) return Response.json({ ok: false, error: "invalid" }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ ok: false, error: "size" }, { status: 400 });
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) return Response.json({ ok: false, error: "type" }, { status: 400 });

  const db = tenantDb(ctx.organizationId);

  if (!chatId && targetUserId) {
    const member = await prisma.membership.findFirst({
      where: { organizationId: ctx.organizationId, userId: targetUserId },
      select: { userId: true },
    });
    if (!member) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    chatId = await getOrCreateDirectChat(ctx.organizationId, ctx.userId, targetUserId);
  }
  if (!chatId || !(await isChatParticipant(ctx.organizationId, chatId, ctx.userId))) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const safeName = (file.name || "arquivo").replace(/[^\w.\-]+/g, "_").slice(0, 120) || "arquivo";
  const preview = body || `📎 ${file.name || safeName}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await putMedia(`team/${chatId}/${randomUUID()}-${safeName}`, buffer, mime);

    await db.teamChatMessage.create({
      data: {
        organizationId: ctx.organizationId,
        chatId,
        senderId: ctx.userId,
        body,
        fileUrl: stored.url,
        fileName: file.name || safeName,
        fileMime: mime,
        fileSize: stored.size,
      },
    });
    await db.teamChat.updateMany({
      where: { id: chatId },
      data: { lastMessageAt: new Date(), lastMessagePreview: preview.slice(0, 200) },
    });
    await db.teamChatParticipant.updateMany({
      where: { chatId, userId: { not: ctx.userId } },
      data: { unreadCount: { increment: 1 } },
    });
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
          data: { actor: ctx.user.name, attachmentType: "FILE" },
          link: `/app/inbox?mode=team&chat=${chatId}`,
        })),
      });
    }
    revalidatePath("/app/inbox");
    return Response.json({ ok: true, chatId });
  } catch (error) {
    console.error("[team-chat] send file failed", error);
    return Response.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}
