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

/** Copilot uses today = user turns stored since midnight (org-wide). */
export async function assistantDailyCount(organizationId: string): Promise<number> {
  return tenantDb(organizationId).assistantMessage.count({
    where: { role: "user", createdAt: { gte: startOfToday() } },
  });
}

/** True when the org has hit its plan's daily copilot limit. */
export async function isAssistantOverDailyLimit(organizationId: string): Promise<boolean> {
  const limit = LIMITS.assistantDailyLimit;
  if (limit >= UNLIMITED) return false;
  if (limit <= 0) return true;
  const used = await assistantDailyCount(organizationId);
  return used >= limit;
}
