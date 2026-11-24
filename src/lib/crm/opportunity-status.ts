/**
 * The opportunity statuses and their rules, in one place for the server, the client, the copilot and the
 * MCP. Pure: no server or React imports.
 *
 * OPEN/ON_HOLD are active (no closedAt). WON, LOST, CANCELED and DECLINED are closed. LOST, CANCELED and
 * DECLINED need a reason. DECLINED means the company itself chose not to go on with the deal (did not bid
 * or quote); it is not a loss, so it stays out of the win rate, like CANCELED.
 */
export const OPPORTUNITY_STATUSES = ["OPEN", "ON_HOLD", "WON", "LOST", "CANCELED", "DECLINED"] as const;
export type OpportunityStatusValue = (typeof OPPORTUNITY_STATUSES)[number];

/** Closed statuses that require an outcome reason. */
export const REASON_STATUSES = ["LOST", "CANCELED", "DECLINED"] as const;

export function isOpportunityStatus(value: unknown): value is OpportunityStatusValue {
  return typeof value === "string" && (OPPORTUNITY_STATUSES as readonly string[]).includes(value);
}

export function needsOutcomeReason(status: string): boolean {
  return (REASON_STATUSES as readonly string[]).includes(status);
}

export function isClosedStatus(status: string): boolean {
  return status === "WON" || needsOutcomeReason(status);
}
