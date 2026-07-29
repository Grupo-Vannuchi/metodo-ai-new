import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/** Reuse the user's latest thread, or create one on first use. */
export async function getOrCreateThread(orgId: string, userId: string) {
  const db = tenantDb(orgId);
  const existing = await db.assistantThread.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;
  return db.assistantThread.create({ data: { organizationId: orgId, userId } });
}

/**
 * Resolve the target thread for a turn: the given thread if it belongs to the
 * user, otherwise a brand-new one (so a null threadId starts a fresh chat).
 */
export async function resolveThread(orgId: string, userId: string, threadId?: string | null) {
  const db = tenantDb(orgId);
  if (threadId) {
    const t = await db.assistantThread.findFirst({ where: { id: threadId, userId } });
    if (t) return t;
  }
  return db.assistantThread.create({ data: { organizationId: orgId, userId } });
}

/** Title a fresh thread from its first message (only if still untitled). */
export async function setThreadTitle(orgId: string, threadId: string, text: string): Promise<void> {
  const title = text.trim().slice(0, 60);
  if (!title) return;
  await tenantDb(orgId).assistantThread.updateMany({
    where: { id: threadId, title: null },
    data: { title },
  });
}

export type StoredMessage = { role: string; content: string };

/** Recent turns, oldest first, for conversational continuity. */
export async function loadHistory(
  orgId: string,
  threadId: string,
  limit = 20,
): Promise<StoredMessage[]> {
  const db = tenantDb(orgId);
  const rows = await db.assistantMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { role: true, content: true },
  });
  return rows.reverse();
}

export async function appendMessage(
  orgId: string,
  threadId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const db = tenantDb(orgId);
  await db.assistantMessage.create({ data: { organizationId: orgId, threadId, role, content } });
  await db.assistantThread.updateMany({ where: { id: threadId }, data: { updatedAt: new Date() } });
}
