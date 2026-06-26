import "server-only";
import type { PinnedEntity, TeamChatAttachmentType } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { resolveAttachment } from "@/lib/attachables";

/**
 * Data layer for the personal hub (Meus Itens). Tasks come from the shared
 * `listTasks` (assignedTo me); here we add the pieces unique to the hub:
 * dated opportunities (for the calendar + tab), recent notifications and the
 * user's pinned items.
 */

export type HubOpportunity = {
  id: string;
  code: string | null;
  title: string;
  value: number;
  stageName: string | null;
  expectedCloseDate: Date | null;
};

/** My open opportunities, dated ones first (drives the calendar + the tab). */
export async function myOpportunities(
  organizationId: string,
  userId: string,
): Promise<HubOpportunity[]> {
  const db = tenantDb(organizationId);
  const opps = await db.opportunity.findMany({
    where: { status: "OPEN", ownerId: userId },
    orderBy: [{ expectedCloseDate: "asc" }, { updatedAt: "desc" }],
    take: 300,
    select: {
      id: true,
      code: true,
      title: true,
      value: true,
      expectedCloseDate: true,
      stage: { select: { name: true } },
    },
  });
  return opps.map((o) => ({
    id: o.id,
    code: o.code,
    title: o.title,
    value: Number(o.value),
    stageName: o.stage?.name ?? null,
    expectedCloseDate: o.expectedCloseDate,
  }));
}

export type HubNotification = {
  id: string;
  type: string;
  data: unknown;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/** My most recent notifications, for the hub's Notifications tab. */
export async function recentNotifications(
  organizationId: string,
  userId: string,
  take = 25,
): Promise<HubNotification[]> {
  const db = tenantDb(organizationId);
  return db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, type: true, data: true, link: true, readAt: true, createdAt: true },
  });
}

export type HubPin = {
  pinId: string;
  type: PinnedEntity;
  entityId: string;
  label: string;
  href: string;
};

/** The user's pinned items, each resolved to a label + link (skips ones whose
 * entity was deleted). Reuses resolveAttachment so labels match the rest. */
export async function listPinned(
  organizationId: string,
  userId: string,
): Promise<HubPin[]> {
  const db = tenantDb(organizationId);
  const pins = await db.pinnedItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, entityType: true, entityId: true },
  });
  const resolved = await Promise.all(
    pins.map(async (p) => {
      const r = await resolveAttachment(db, p.entityType as TeamChatAttachmentType, p.entityId);
      return r ? { pinId: p.id, type: p.entityType, entityId: p.entityId, ...r } : null;
    }),
  );
  return resolved.filter((x): x is HubPin => x !== null);
}
