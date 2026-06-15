import "server-only";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";

export type AuditRow = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: Date;
  userName: string;
};

/** Recent audit entries with the actor's name resolved. Scoped to the org. */
export async function listAuditLogs(
  organizationId: string,
  limit = 100,
): Promise<AuditRow[]> {
  const db = tenantDb(organizationId);
  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, userId: true, action: true, entity: true, entityId: true, createdAt: true },
  });

  const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));

  return logs.map((l) => ({
    id: l.id,
    action: l.action,
    entity: l.entity,
    entityId: l.entityId,
    createdAt: l.createdAt,
    userName: l.userId ? names.get(l.userId) ?? "—" : "Sistema",
  }));
}
