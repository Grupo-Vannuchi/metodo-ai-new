import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/** One ongoing thread per user — reuse the latest, create on first use. */
export async function getOrCreateThread(orgId: string, userId: string) {
  const db = tenantDb(orgId);
  const existing = await db.assistantThread.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;
  return db.assistantThread.create({ data: { organizationId: orgId, userId } });
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
