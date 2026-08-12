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
  | "hr" // RH: funcionários, folha de pagamento, férias
  | "supplies" // Suprimentos: cadastro, compras, estoque, patrimônio, calibração
  | "assistant" // Copiloto de IA (Anthropic Claude) embutido no CRM
  | "whatsapp_agent" // Agente de IA que responde clientes no WhatsApp automaticamente
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
  /** Max active integration connections (non-WhatsApp). `null` = unlimited. */
  connectionsLimit: number | null;
  /** Max connected WhatsApp numbers (Evolution/Meta) for the org — one per
   * user. `null` = unlimited. */
  whatsappNumbersLimit: number | null;
  /** Max AI copilot uses (messages) per day, for the whole org. Bounds the
   * per-use Anthropic cost. 0 on plans without the assistant. */
  assistantDailyLimit: number;
  /** Max WhatsApp AI agent auto-replies per day, for the whole org. Bounds the
   * per-reply Anthropic cost of the customer-facing bot. 0 on plans without it. */
  whatsappAgentDailyLimit: number;
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
  // RH shares the Financeiro gate: payroll posts into the finance ledger.
  "hr",
  // Suprimentos — módulo operacional premium (estoque, compras, patrimônio).
  "supplies",
  // AI copilot — a premium differentiator; keeps per-use API cost on paid tiers.
  "assistant",
  // WhatsApp AI auto-responder — customer-facing agent; premium, per-use cost.
  "whatsapp_agent",
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
    whatsappNumbersLimit: 3,
    assistantDailyLimit: 0,
    whatsappAgentDailyLimit: 0,
    features: STANDARD_FEATURES,
  },
  PLUS: {
    seatLimit: 10,
    dispatchQuotaPerMonth: 10_000,
    prospectingQuotaPerMonth: 2_000,
    extractionsPerMonth: 100,
    connectionsLimit: 3,
    whatsappNumbersLimit: 10,
    assistantDailyLimit: 200,
    whatsappAgentDailyLimit: 500,
    features: PLUS_FEATURES,
  },
  GOLD: {
    seatLimit: 25,
    dispatchQuotaPerMonth: 50_000,
    prospectingQuotaPerMonth: 10_000,
    extractionsPerMonth: 500,
    connectionsLimit: null,
    whatsappNumbersLimit: 25,
    assistantDailyLimit: 750,
    whatsappAgentDailyLimit: 2_000,
    features: GOLD_FEATURES,
  },
  ENTERPRISE: {
    seatLimit: 1_000,
    dispatchQuotaPerMonth: 1_000_000,
    prospectingQuotaPerMonth: 100_000,
    extractionsPerMonth: 5_000,
    connectionsLimit: null,
    whatsappNumbersLimit: null,
    assistantDailyLimit: 3_000,
    whatsappAgentDailyLimit: 10_000,
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
