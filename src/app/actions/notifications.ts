"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";

/** Mark every unread notification of the current user as read. Tenant-scoped:
 * `Notification` is in TENANT_MODELS, so the org is injected into the filter. */
export async function clearNotifications(): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    await db.notification.updateMany({
      where: { userId: ctx.userId, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath("/app");
    return { ok: true };
  } catch (error) {
    console.error("Failed to clear notifications:", error);
    return { ok: false };
  }
}

/** Mark a single notification (the one clicked) as read. */
export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    await db.notification.updateMany({
      where: { id, userId: ctx.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  } catch (error) {
    console.error("Failed to mark notification read:", error);
    return { ok: false };
  }
}
