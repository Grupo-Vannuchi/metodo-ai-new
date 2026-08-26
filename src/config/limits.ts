/**
 * Global usage limits — one set for every organization. The old per-plan tiers
 * (STANDARD/PLUS/GOLD/ENTERPRISE) are gone: with modularity, what an org can do
 * is decided by the modules it installs (see src/config/modules.ts), not a plan.
 * These bound abuse/cost uniformly. `null` means unlimited.
 */
export const LIMITS: {
  /** Members (seats) per org. */
  seatLimit: number;
  /** Non-WhatsApp integration connections per org. `null` = unlimited. */
  connectionsLimit: number | null;
  /** Connected WhatsApp numbers per org (one per user). `null` = unlimited. */
  whatsappNumbersLimit: number | null;
  /** Campaign dispatches per month. */
  dispatchQuotaPerMonth: number;
  /** Prospecting leads per month. */
  prospectingQuotaPerMonth: number;
  /** Prospecting extraction jobs per month. */
  extractionsPerMonth: number;
  /** AI copilot uses per day (org-wide). */
  assistantDailyLimit: number;
  /** WhatsApp AI agent auto-replies per day (org-wide). */
  whatsappAgentDailyLimit: number;
  /** Companies (organizations) an account owner can have. */
  companiesPerAccount: number;
} = {
  seatLimit: 25,
  connectionsLimit: null,
  whatsappNumbersLimit: 10,
  dispatchQuotaPerMonth: 50_000,
  prospectingQuotaPerMonth: 10_000,
  extractionsPerMonth: 500,
  assistantDailyLimit: 750,
  whatsappAgentDailyLimit: 2_000,
  companiesPerAccount: 5,
};
