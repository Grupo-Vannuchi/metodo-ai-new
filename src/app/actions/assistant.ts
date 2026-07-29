"use server";

import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";

export type ThreadSummary = { id: string; title: string; updatedAt: string };
export type ThreadMessage = { role: string; content: string };

/** The user's copilot chats, most recent first. */
export async function listAssistantThreads(): Promise<ThreadSummary[]> {
  const ctx = await getOrgContext();
  if (!ctx) return [];
  const rows = await tenantDb(ctx.organizationId).assistantThread.findMany({
    where: { userId: ctx.userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map((r) => ({ id: r.id, title: r.title ?? "", updatedAt: r.updatedAt.toISOString() }));
}

/** Start a new empty chat and return its id. */
export async function createAssistantThread(): Promise<{ id: string } | null> {
  const ctx = await getOrgContext();
  if (!ctx) return null;
  const t = await tenantDb(ctx.organizationId).assistantThread.create({
    data: { organizationId: ctx.organizationId, userId: ctx.userId },
  });
  return { id: t.id };
}

/** Delete one of the user's chats (and its messages, via cascade). */
export async function deleteAssistantThread(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  await tenantDb(ctx.organizationId).assistantThread.deleteMany({
    where: { id, userId: ctx.userId },
  });
  return { ok: true };
}

/** Load a chat's messages (only if it belongs to the caller). */
export async function loadAssistantThread(id: string): Promise<ThreadMessage[]> {
  const ctx = await getOrgContext();
  if (!ctx) return [];
  const db = tenantDb(ctx.organizationId);
  const owns = await db.assistantThread.findFirst({ where: { id, userId: ctx.userId }, select: { id: true } });
  if (!owns) return [];
  const rows = await db.assistantMessage.findMany({
    where: { threadId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { role: true, content: true },
  });
  return rows.map((r) => ({ role: r.role, content: r.content }));
}
