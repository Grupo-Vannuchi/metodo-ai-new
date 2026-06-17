"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";

/** Reset a conversation's unread counter (called when it's opened). */
export async function markConversationRead(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    await db.conversation.updateMany({ where: { id }, data: { unreadCount: 0 } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to mark conversation read", error);
    return { ok: false };
  }
}
