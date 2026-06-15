import "server-only";
import { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import type { OrgContext } from "@/lib/tenant";

export type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string;
  meta?: Record<string, unknown>;
};

/**
 * Write an audit-trail entry. Best-effort: never throws, so a logging failure
 * can't break the action that triggered it. Scoped to the actor's org.
 */
export async function audit(ctx: OrgContext, entry: AuditEntry): Promise<void> {
  try {
    const db = tenantDb(ctx.organizationId);
    await db.auditLog.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        meta: (entry.meta ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("[audit] failed to write", error);
  }
}
