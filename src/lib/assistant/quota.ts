import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { LIMITS } from "@/config/limits";

/** Anything at/above this is shown/treated as "unlimited". */
const UNLIMITED = 1_000_000;

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** AI uses outside the copilot chat that count toward the same daily limit, by their audit action. */
export const AI_USE_AUDIT_ACTIONS = ["assistant.proposal_scope"] as const;

/**
 * Copilot uses today (org-wide): the user turns stored since midnight, plus the other AI uses, each logged in the audit
 * trail ("Gerar escopo com IA" in the proposal form, src/app/actions/proposal-ai.ts).
 */
export async function assistantDailyCount(organizationId: string): Promise<number> {
  const db = tenantDb(organizationId);
  const since = startOfToday();
  const [chat, other] = await Promise.all([
    db.assistantMessage.count({ where: { role: "user", createdAt: { gte: since } } }),
    db.auditLog.count({ where: { action: { in: [...AI_USE_AUDIT_ACTIONS] }, createdAt: { gte: since } } }),
  ]);
  return chat + other;
}

/** True when the org has hit its plan's daily copilot limit. */
export async function isAssistantOverDailyLimit(organizationId: string): Promise<boolean> {
  const limit = LIMITS.assistantDailyLimit;
  if (limit >= UNLIMITED) return false;
  if (limit <= 0) return true;
  const used = await assistantDailyCount(organizationId);
  return used >= limit;
}
