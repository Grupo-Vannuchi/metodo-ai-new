import type { PlanKey } from "@/config/plans";

/**
 * Marketing display config for the pricing page. The hard limits come from
 * `config/plans.ts` (single source of truth); this file only holds the
 * presentation bits — display price and which plan to highlight. Edit the prices
 * here. Plan names and feature copy live in `messages/*.json` under `pricing`.
 */
export type PricingEntry = {
  key: PlanKey;
  /** Display price (free text so you can write "R$ 97/mês", "Sob consulta"…). */
  price: string;
  /** Visually highlight this plan as the recommended one. */
  highlight?: boolean;
};

export const PRICING: PricingEntry[] = [
  { key: "STANDARD", price: "R$ 97/mês" },
  { key: "PLUS", price: "R$ 297/mês", highlight: true },
  { key: "GOLD", price: "R$ 697/mês" },
  { key: "ENTERPRISE", price: "Sob consulta" },
];
