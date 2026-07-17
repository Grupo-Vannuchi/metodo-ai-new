import { getOrgContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A user counts as "online" if their heartbeat is within this window. */
const ONLINE_MS = 35_000;
/** A "typing" signal is fresh for this long after the last keystroke. */
const TYPING_MS = 6_000;

/**
 * Team-chat presence + typing heartbeat. The chat client POSTs this every few
 * seconds (with the active chatId, and whether the user is currently typing).
 * It updates the caller's own presence and returns, for the caller's org: which
 * members are online, and who is typing in the given chat. No pub/sub — this is
 * lightweight polling that fits the app's fingerprint-SSE model.
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  let chatId: string | null = null;
  let typing = false;
  try {
    const body = (await req.json().catch(() => null)) as { chatId?: string; typing?: boolean } | null;
    if (body?.chatId && typeof body.chatId === "string") chatId = body.chatId.slice(0, 40);
    typing = Boolean(body?.typing);
  } catch {
    /* ignore */
  }

  const now = new Date();
  // Update the caller's presence + typing state.
  await prisma.user.update({
    where: { id: ctx.userId },
    data: {
      lastSeenAt: now,
      typingChatId: typing && chatId ? chatId : null,
      typingAt: typing && chatId ? now : null,
    },
  });

  // Presence is org-scoped: only reveal members of the caller's organization.
  const members = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId },
    select: { user: { select: { id: true, lastSeenAt: true, typingChatId: true, typingAt: true } } },
  });

  const onlineFloor = now.getTime() - ONLINE_MS;
  const typingFloor = now.getTime() - TYPING_MS;
  const online: string[] = [];
  const typingUsers: string[] = [];
  for (const { user } of members) {
    if (user.lastSeenAt && user.lastSeenAt.getTime() >= onlineFloor) online.push(user.id);
    if (
      user.id !== ctx.userId &&
      chatId &&
      user.typingChatId === chatId &&
      user.typingAt &&
      user.typingAt.getTime() >= typingFloor
    ) {
      typingUsers.push(user.id);
    }
  }

  return Response.json({ online, typing: typingUsers });
}
