/**
 * Client-safe automation vocabulary (no server imports) so both the canvas
 * editor and the engine can share the shapes.
 */

export const TRIGGERS = [
  "opportunity_created",
  "stage_entered",
  "opportunity_won",
  "opportunity_lost",
  "task_completed",
] as const;
export type TriggerType = (typeof TRIGGERS)[number];

/** Triggers whose editor needs a stage picker. */
export function triggerNeedsStage(t: TriggerType): boolean {
  return t === "stage_entered";
}

export const ACTION_TYPES = ["create_task", "notify_owner", "send_whatsapp", "move_stage", "set_owner"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";

export type RuleAction =
  | { type: "create_task"; title: string; description?: string; priority?: TaskPriority; dueInDays?: number }
  | { type: "notify_owner"; message?: string }
  | { type: "send_whatsapp"; templateId: string }
  | { type: "move_stage"; stageId: string }
  | { type: "set_owner"; userId: string };

export type NodePos = { x: number; y: number };
export type RuleConfig = {
  /** Only fire when the opportunity's value is at least this. */
  minValue?: number;
  /** Canvas positions so the layout persists. */
  layout?: { trigger?: NodePos; actions?: NodePos[] };
};

export function isTrigger(v: string): v is TriggerType {
  return (TRIGGERS as readonly string[]).includes(v);
}

const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH"];
const str = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Validate + normalize a raw actions array (from the form or the DB JSON). */
export function parseActions(raw: unknown): RuleAction[] {
  if (!Array.isArray(raw)) return [];
  const out: RuleAction[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    switch (o.type) {
      case "create_task": {
        const priority = PRIORITIES.includes(o.priority as TaskPriority) ? (o.priority as TaskPriority) : undefined;
        const due = num(o.dueInDays);
        out.push({
          type: "create_task",
          title: str(o.title, 160),
          description: str(o.description, 1000) || undefined,
          priority,
          dueInDays: due !== undefined ? Math.max(0, Math.min(365, Math.round(due))) : undefined,
        });
        break;
      }
      case "notify_owner":
        out.push({ type: "notify_owner", message: str(o.message, 300) || undefined });
        break;
      case "send_whatsapp":
        if (str(o.templateId)) out.push({ type: "send_whatsapp", templateId: str(o.templateId) });
        break;
      case "move_stage":
        if (str(o.stageId)) out.push({ type: "move_stage", stageId: str(o.stageId) });
        break;
      case "set_owner":
        if (str(o.userId)) out.push({ type: "set_owner", userId: str(o.userId) });
        break;
    }
  }
  return out.slice(0, 15);
}

export function parseConfig(raw: unknown): RuleConfig {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const cfg: RuleConfig = {};
  const min = num(o.minValue);
  if (min !== undefined && min > 0) cfg.minValue = min;
  const layout = o.layout as Record<string, unknown> | undefined;
  if (layout && typeof layout === "object") {
    const pos = (p: unknown): NodePos | undefined => {
      if (!p || typeof p !== "object") return undefined;
      const x = num((p as NodePos).x);
      const y = num((p as NodePos).y);
      return x !== undefined && y !== undefined ? { x, y } : undefined;
    };
    const trigger = pos(layout.trigger);
    const actions = Array.isArray(layout.actions)
      ? (layout.actions.map(pos).filter(Boolean) as NodePos[])
      : undefined;
    cfg.layout = { trigger, actions };
  }
  return cfg;
}
