"use server";

import { revalidatePath } from "next/cache";
import type { PinnedEntity } from "@prisma/client";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";

const PINNABLE: PinnedEntity[] = ["TASK", "OPP", "CONTACT", "COMPANY"];

/** Pin/unpin an entity for the current user's personal hub (idempotent toggle). */
export async function togglePin(
  entityType: PinnedEntity,
  entityId: string,
): Promise<{ ok: boolean; pinned?: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  if (!PINNABLE.includes(entityType) || !entityId) return { ok: false };

  const db = tenantDb(ctx.organizationId);
  const existing = await db.pinnedItem.findFirst({
    where: { userId: ctx.userId, entityType, entityId },
    select: { id: true },
  });

  if (existing) {
    await db.pinnedItem.deleteMany({ where: { id: existing.id } });
    revalidatePath("/app/my");
    return { ok: true, pinned: false };
  }

  await db.pinnedItem.create({
    data: { organizationId: ctx.organizationId, userId: ctx.userId, entityType, entityId },
  });
  revalidatePath("/app/my");
  return { ok: true, pinned: true };
}
