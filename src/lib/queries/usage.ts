import "server-only";
import { planConfig, type PlanKey } from "@/config/plans";
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

/** Current usage vs. the plan's limits, for the settings usage panel. */
export async function getUsageSummary(
  organizationId: string,
  plan: PlanKey,
): Promise<UsageSummary> {
  const cfg = planConfig(plan);
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
    seats: { used: seats, limit: cfg.seatLimit },
    connections: { used: connections, limit: cfg.connectionsLimit },
    dispatch: { used: dispatch, limit: cfg.dispatchQuotaPerMonth },
    prospecting: { used: prospecting, limit: cfg.prospectingQuotaPerMonth },
    searches: { used: searches, limit: cfg.extractionsPerMonth },
    assistant: { used: assistant, limit: cfg.assistantDailyLimit },
  };
}
