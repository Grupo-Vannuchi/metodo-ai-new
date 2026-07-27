import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { parseActions, type RuleAction, type TriggerType } from "@/lib/automation/types";

export type AutomationRuleView = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: TriggerType;
  triggerStageId: string | null;
  actions: RuleAction[];
};

/** All automation rules for the org, newest first. */
export async function listAutomationRules(organizationId: string): Promise<AutomationRuleView[]> {
  const db = tenantDb(organizationId);
  const rows = await db.automationRule.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, enabled: true, trigger: true, triggerStageId: true, actions: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger: r.trigger as TriggerType,
    triggerStageId: r.triggerStageId,
    actions: parseActions(r.actions),
  }));
}
