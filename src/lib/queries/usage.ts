import "server-only";
import { planConfig, type PlanKey } from "@/config/plans";
import { countMembers } from "@/lib/queries/organizations";
import { countConnections } from "@/lib/queries/connections";
import { countDispatchedSince } from "@/lib/queries/campaigns";
import { countLeadsSince } from "@/lib/queries/extractions";

export type UsageMetric = { used: number; limit: number | null };

export type UsageSummary = {
  seats: UsageMetric;
  connections: UsageMetric;
  dispatch: UsageMetric;
  prospecting: UsageMetric;
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

  const [seats, connections, dispatch, prospecting] = await Promise.all([
    countMembers(organizationId),
    countConnections(organizationId),
    countDispatchedSince(organizationId, monthStart),
    countLeadsSince(organizationId, monthStart),
  ]);

  return {
    seats: { used: seats, limit: cfg.seatLimit },
    connections: { used: connections, limit: cfg.connectionsLimit },
    dispatch: { used: dispatch, limit: cfg.dispatchQuotaPerMonth },
    prospecting: { used: prospecting, limit: cfg.prospectingQuotaPerMonth },
  };
}
