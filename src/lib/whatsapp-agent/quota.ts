import "server-only";
import { prisma } from "@/lib/prisma";
import { LIMITS } from "@/config/limits";

/** Anything at/above this is treated as "unlimited". */
const UNLIMITED = 1_000_000;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Auto-replies the agent has sent for this org since midnight (org-wide). */
export async function agentDailyReplyCount(organizationId: string): Promise<number> {
  return prisma.message.count({
    where: { organizationId, direction: "OUTBOUND", agentReply: true, createdAt: { gte: startOfToday() } },
  });
}

/** True when the org has hit its plan's daily WhatsApp-agent reply cap. Bounds
 *  the per-reply Anthropic cost. Called on the (non-request) pipeline, so it
 *  takes the plain client + explicit organizationId rather than tenantDb. */
export async function isAgentOverDailyLimit(organizationId: string): Promise<boolean> {
  const limit = LIMITS.whatsappAgentDailyLimit;
  if (limit >= UNLIMITED) return false;
  if (limit <= 0) return true;
  const used = await agentDailyReplyCount(organizationId);
  return used >= limit;
}
