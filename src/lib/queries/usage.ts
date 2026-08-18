import "server-only";
import { LIMITS } from "@/config/limits";
import { countMembers } from "@/lib/queries/organizations";
import { countConnections } from "@/lib/queries/connections";
import { countDispatchedSince } from "@/lib/queries/campaigns";
import { countLeadsSince, countJobsSince } from "@/lib/queries/extractions";
import { assistantDailyCount } from "@/lib/assistant/quota";

export type UsageMetric = { used: number; limit: number | null };

export type UsageSummary = {
  seats: UsageMetric;
  connections: UsageMetric;
  dispatch: UsageMetric;
  prospecting: UsageMetric;
  searches: UsageMetric;
  /** AI copilot uses today (org-wide) vs. the plan's daily limit. */
  assistant: UsageMetric;
};

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Current usage vs. the global limits, for the settings usage panel. */
export async function getUsageSummary(organizationId: string): Promise<UsageSummary> {
  const monthStart = startOfMonth();

  const [seats, connections, dispatch, prospecting, searches, assistant] = await Promise.all([
    countMembers(organizationId),
    countConnections(organizationId),
    countDispatchedSince(organizationId, monthStart),
    countLeadsSince(organizationId, monthStart),
    countJobsSince(organizationId, monthStart),
    assistantDailyCount(organizationId),
  ]);

  return {
    seats: { used: seats, limit: LIMITS.seatLimit },
    connections: { used: connections, limit: LIMITS.connectionsLimit },
    dispatch: { used: dispatch, limit: LIMITS.dispatchQuotaPerMonth },
    prospecting: { used: prospecting, limit: LIMITS.prospectingQuotaPerMonth },
    searches: { used: searches, limit: LIMITS.extractionsPerMonth },
    assistant: { used: assistant, limit: LIMITS.assistantDailyLimit },
  };
}
