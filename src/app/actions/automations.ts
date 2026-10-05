"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { hasModule } from "@/config/modules";
import { isTrigger, isWhatsappTrigger, parseActions, parseConfig, ruleProblem } from "@/lib/automation/types";

export type RuleResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "unknown" };

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
  if (!isTrigger(trigger)) return null;
  const actions = parseActions(input.actions);
  const config = parseConfig(input.config);
  const triggerStageId = trigger === "stage_entered" ? (input.triggerStageId ?? "").trim() || null : null;
  if (!isWhatsappTrigger(trigger)) delete config.whatsapp;
  if (ruleProblem({ name, trigger, triggerStageId, actions, config })) return null;
  return { name, trigger, triggerStageId, actions, config };
}

/** A WhatsApp rule needs the Atendimento module and a number of this org. */
async function checkWhatsapp(ctx: OrgCtx, data: NonNullable<ReturnType<typeof normalize>>): Promise<RuleResult | null> {
  if (!isWhatsappTrigger(data.trigger)) return null;
  if (!hasModule(ctx.modules, "inbox")) return { ok: false, error: "forbidden" };
  const conn = await tenantDb(ctx.organizationId).integrationConnection.findFirst({
    where: { id: data.config.whatsapp?.connectionId, provider: "EVOLUTION" },
    select: { id: true },
  });
  return conn ? null : { ok: false, error: "invalid" };
}

export async function createRule(input: RuleInput): Promise<RuleResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const data = normalize(input);
  if (!data) return { ok: false, error: "invalid" };
  try {
    const rejected = await checkWhatsapp(g.ctx, data);
    if (rejected) return rejected;
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
    const rejected = await checkWhatsapp(g.ctx, data);
    if (rejected) return rejected;
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
