"use server";

import { z } from "zod";
import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasFeatureByModules } from "@/config/modules";
import { isAssistantConfigured } from "@/lib/assistant/config";
import { isAssistantOverDailyLimit } from "@/lib/assistant/quota";
import { makeRateLimiter } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";
import { draftProposalScope } from "@/lib/proposals/ai-scope";

export type ProposalScopeResult =
  | { ok: true; text: string }
  | {
      ok: false;
      error: "unauthorized" | "not_available" | "daily_limit" | "rate_limited" | "invalid" | "refused" | "cut" | "unknown";
    };

const scopeSchema = z.object({
  title: z.string().trim().max(200),
  clientCompany: z.string().trim().max(200),
  clientName: z.string().trim().max(200),
  items: z
    .array(
      z.object({
        name: z.string().trim().max(200),
        description: z.string().trim().max(1000),
        quantity: z.number().finite().min(0).max(1_000_000),
      }),
    )
    .max(50),
  opportunityId: z.string().trim().max(40),
  instruction: z.string().trim().max(1000),
  current: z.string().max(12_000),
});

/**
 * "Gerar escopo com IA" (rules and prompt in src/lib/proposals/ai-scope.ts). The same gates as the copilot: the proposals
 * screen, the AI module, a configured key, the org's daily copilot limit and a per-person rate limit. Returns the text for
 * the person to review; nothing is saved.
 */
export async function generateProposalScope(input: z.input<typeof scopeSchema>): Promise<ProposalScopeResult> {
  const ctx = await getOrgContext();
  if (!ctx || !canAccessScreen(ctx, "proposals")) return { ok: false, error: "unauthorized" };
  if (!hasFeatureByModules(ctx.modules, "assistant") || !isAssistantConfigured()) {
    return { ok: false, error: "not_available" };
  }
  const parsed = scopeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (await isAssistantOverDailyLimit(ctx.organizationId)) return { ok: false, error: "daily_limit" };
  const limiter = makeRateLimiter("proposal-scope", 10, 60);
  if (limiter) {
    const { success } = await limiter.limit(`${ctx.organizationId}:${ctx.userId}`);
    if (!success) return { ok: false, error: "rate_limited" };
  }
  // Logged before the call, so every request that reaches the API counts toward the org's daily AI limit
  // (assistantDailyCount reads these rows), whatever the API answers.
  await audit(ctx, {
    action: "assistant.proposal_scope",
    entity: "Proposal",
    meta: { opportunityId: parsed.data.opportunityId || null },
  });

  try {
    const res = await draftProposalScope(ctx.organizationId, ctx.organization.name, parsed.data);
    if (res.ok) return res;
    return { ok: false, error: res.error === "unavailable" ? "not_available" : res.error };
  } catch (error) {
    console.error("[proposal-scope] failed", error);
    return { ok: false, error: "unknown" };
  }
}
