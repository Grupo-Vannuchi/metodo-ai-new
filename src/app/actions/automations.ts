"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { isTrigger, parseActions, parseConfig } from "@/lib/automation/types";

export type RuleResult = { ok: true; id: string } | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

type RuleInput = {
  name: string;
  trigger: string;
  triggerStageId?: string | null;
  actions: unknown;
  config?: unknown;
};

type OrgCtx = NonNullable<Awaited<ReturnType<typeof getOrgContext>>>;
type Guard = { error: "unauthorized" } | { ctx: OrgCtx };

// Any member of the org (with CRM access to reach the page) can manage rules.
async function guard(): Promise<Guard> {
  const ctx = await getOrgContext();
  if (!ctx) return { error: "unauthorized" };
  return { ctx };
}

function normalize(input: RuleInput) {
  const name = (input.name ?? "").trim().slice(0, 120);
  const trigger = (input.trigger ?? "").trim();
  const actions = parseActions(input.actions);
  const config = parseConfig(input.config);
  if (!name || !isTrigger(trigger) || actions.length === 0) return null;
  const triggerStageId = trigger === "stage_entered" ? (input.triggerStageId ?? "").trim() || null : null;
  if (trigger === "stage_entered" && !triggerStageId) return null;
  return { name, trigger, triggerStageId, actions, config };
}

export async function createRule(input: RuleInput): Promise<RuleResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const data = normalize(input);
  if (!data) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(g.ctx.organizationId);
    const rule = await db.automationRule.create({
      data: { organizationId: g.ctx.organizationId, ...data, actions: data.actions },
      select: { id: true },
    });
    revalidatePath("/app/automations");
    return { ok: true, id: rule.id };
  } catch (e) {
    console.error("createRule failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function updateRule(id: string, input: RuleInput): Promise<RuleResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const data = normalize(input);
  if (!data) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(g.ctx.organizationId);
    const res = await db.automationRule.updateMany({ where: { id }, data: { ...data, actions: data.actions } });
    if (res.count === 0) return { ok: false, error: "unknown" };
    revalidatePath("/app/automations");
    return { ok: true, id };
  } catch (e) {
    console.error("updateRule failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function toggleRule(id: string, enabled: boolean): Promise<{ ok: boolean }> {
  const g = await guard();
  if ("error" in g) return { ok: false };
  try {
    const db = tenantDb(g.ctx.organizationId);
    await db.automationRule.updateMany({ where: { id }, data: { enabled } });
    revalidatePath("/app/automations");
    return { ok: true };
  } catch (e) {
    console.error("toggleRule failed", e);
    return { ok: false };
  }
}

export async function deleteRule(id: string): Promise<{ ok: boolean }> {
  const g = await guard();
  if ("error" in g) return { ok: false };
  try {
    const db = tenantDb(g.ctx.organizationId);
    await db.automationRule.deleteMany({ where: { id } });
    revalidatePath("/app/automations");
    return { ok: true };
  } catch (e) {
    console.error("deleteRule failed", e);
    return { ok: false };
  }
}
