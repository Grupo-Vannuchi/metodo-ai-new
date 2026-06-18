/**
 * ─────────────────────────────────────────────────────────────────────────
 *  PLANS & FEATURE GATING — single source of truth
 * ─────────────────────────────────────────────────────────────────────────
 * Every plan-dependent limit and feature flag lives here. Code must gate on
 * `hasFeature(plan, …)` / the limits below — NEVER scatter `if (plan === …)`
 * across the app (PLANO.md §11, rule 5). When a tenant signs up or changes
 * plan, `Organization.seatLimit` is materialised from `PLANS[plan].seatLimit`.
 */

/** Mirrors the Prisma `Plan` enum (kept as a local union to avoid coupling). */
export type PlanKey = "STANDARD" | "PLUS" | "GOLD" | "ENTERPRISE";

/** Capabilities that can be gated by plan. */
export type Feature =
  | "campaigns.whatsapp" // WhatsApp dispatch (Evolution / Meta Cloud)
  | "campaigns.email" // E-mail dispatch
  | "campaigns.scheduling.advanced" // recurrence, time windows, weekdays
  | "prospecting" // Google Places lead extraction (tenant's own key)
  | "finance" // Financeiro: lançamentos, fluxo de caixa, DRE
  | "webhooks.outbound" // outbound webhooks to the customer's systems
  | "sso"; // single sign-on

export type PlanConfig = {
  /** Number of seats (memberships) allowed. */
  seatLimit: number;
  /** Max messages dispatched per calendar month. */
  dispatchQuotaPerMonth: number;
  /** Max leads extracted per calendar month. Bounds our scraping/compute; the
   * Google API cost itself is billed on the tenant's own key. */
  prospectingQuotaPerMonth: number;
  /** Max prospecting searches (extraction runs) per calendar month. */
  extractionsPerMonth: number;
  /** Max active integration connections. `null` = unlimited. */
  connectionsLimit: number | null;
  /** Features unlocked by this plan. */
  features: Feature[];
};

const STANDARD_FEATURES: Feature[] = [
  "campaigns.whatsapp",
  "campaigns.email",
  "prospecting",
];

const PLUS_FEATURES: Feature[] = [
  ...STANDARD_FEATURES,
  "campaigns.scheduling.advanced",
  "finance",
];

const GOLD_FEATURES: Feature[] = [...PLUS_FEATURES];

const ENTERPRISE_FEATURES: Feature[] = [
  ...GOLD_FEATURES,
  "webhooks.outbound",
  "sso",
];

export const PLANS: Record<PlanKey, PlanConfig> = {
  STANDARD: {
    seatLimit: 3,
    dispatchQuotaPerMonth: 1_000,
    prospectingQuotaPerMonth: 200,
    extractionsPerMonth: 20,
    connectionsLimit: 1,
    features: STANDARD_FEATURES,
  },
  PLUS: {
    seatLimit: 10,
    dispatchQuotaPerMonth: 10_000,
    prospectingQuotaPerMonth: 2_000,
    extractionsPerMonth: 100,
    connectionsLimit: 3,
    features: PLUS_FEATURES,
  },
  GOLD: {
    seatLimit: 25,
    dispatchQuotaPerMonth: 50_000,
    prospectingQuotaPerMonth: 10_000,
    extractionsPerMonth: 500,
    connectionsLimit: null,
    features: GOLD_FEATURES,
  },
  ENTERPRISE: {
    seatLimit: 1_000,
    dispatchQuotaPerMonth: 1_000_000,
    prospectingQuotaPerMonth: 100_000,
    extractionsPerMonth: 5_000,
    connectionsLimit: null,
    features: ENTERPRISE_FEATURES,
  },
};

/** True when the plan unlocks the given feature. */
export function hasFeature(plan: PlanKey, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature);
}

/**
 * Throws when the plan does not include the feature. Use at the top of
 * Server Actions / job handlers that perform plan-gated work.
 */
export function assertFeature(plan: PlanKey, feature: Feature): void {
  if (!hasFeature(plan, feature)) {
    throw new Error(`Plan ${plan} does not include feature "${feature}"`);
  }
}

/** Convenience accessor for a plan's configuration. */
export function planConfig(plan: PlanKey): PlanConfig {
  return PLANS[plan];
}
