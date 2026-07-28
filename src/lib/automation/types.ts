/**
 * Client-safe automation vocabulary (no server imports) so both the canvas
 * editor and the engine can share the shapes.
 */

export const TRIGGERS = [
  "opportunity_created",
  "stage_entered",
  "opportunity_won",
  "opportunity_lost",
  "opportunity_reopened",
  "proposal_accepted",
  "task_completed",
] as const;
export type TriggerType = (typeof TRIGGERS)[number];

/** Triggers whose editor needs a stage picker. */
export function triggerNeedsStage(t: TriggerType): boolean {
  return t === "stage_entered";
}

export const ACTION_TYPES = [
  "create_task",
  "notify_owner",
  "notify_user",
  "send_whatsapp",
  "send_email",
  "move_stage",
  "set_owner",
  "set_expected_close",
  "add_tag",
  "create_finance_entry",
  "webhook",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";

export type RuleAction =
  | { type: "create_task"; title: string; description?: string; priority?: TaskPriority; dueInDays?: number }
  | { type: "notify_owner"; message?: string }
  | { type: "notify_user"; userId: string; message?: string }
  | { type: "send_whatsapp"; templateId: string }
  | { type: "send_email"; subject: string; body: string }
  | { type: "move_stage"; stageId: string }
  | { type: "set_owner"; userId: string }
  | { type: "set_expected_close"; inDays: number }
  | { type: "add_tag"; tag: string }
  | { type: "create_finance_entry"; description: string; useOppValue?: boolean; amount?: number; dueInDays?: number }
  | { type: "webhook"; url: string };

export type NodePos = { x: number; y: number };
export type RuleConfig = {
  /** Only fire when the opportunity's value is at least this. */
  minValue?: number;
  /** Only fire when the opportunity's value is at most this. */
  maxValue?: number;
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
const days = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined ? Math.max(0, Math.min(365, Math.round(n))) : undefined;
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
        out.push({
          type: "create_task",
          title: str(o.title, 160),
          description: str(o.description, 1000) || undefined,
          priority,
          dueInDays: days(o.dueInDays),
        });
        break;
      }
      case "notify_owner":
        out.push({ type: "notify_owner", message: str(o.message, 300) || undefined });
        break;
      case "notify_user":
        if (str(o.userId)) out.push({ type: "notify_user", userId: str(o.userId), message: str(o.message, 300) || undefined });
        break;
      case "send_whatsapp":
        if (str(o.templateId)) out.push({ type: "send_whatsapp", templateId: str(o.templateId) });
        break;
      case "send_email":
        if (str(o.subject) && str(o.body)) out.push({ type: "send_email", subject: str(o.subject, 200), body: str(o.body, 4000) });
        break;
      case "move_stage":
        if (str(o.stageId)) out.push({ type: "move_stage", stageId: str(o.stageId) });
        break;
      case "set_owner":
        if (str(o.userId)) out.push({ type: "set_owner", userId: str(o.userId) });
        break;
      case "set_expected_close": {
        const d = days(o.inDays);
        out.push({ type: "set_expected_close", inDays: d ?? 0 });
        break;
      }
      case "add_tag":
        if (str(o.tag, 40).trim()) out.push({ type: "add_tag", tag: str(o.tag, 40).trim() });
        break;
      case "create_finance_entry":
        out.push({
          type: "create_finance_entry",
          description: str(o.description, 200) || "Recebível",
          useOppValue: o.useOppValue !== false,
          amount: num(o.amount),
          dueInDays: days(o.dueInDays),
        });
        break;
      case "webhook": {
        const url = str(o.url, 500);
        if (/^https?:\/\//i.test(url)) out.push({ type: "webhook", url });
        break;
      }
    }
  }
  return out.slice(0, 20);
}

export function parseConfig(raw: unknown): RuleConfig {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const cfg: RuleConfig = {};
  const min = num(o.minValue);
  if (min !== undefined && min > 0) cfg.minValue = min;
  const max = num(o.maxValue);
  if (max !== undefined && max > 0) cfg.maxValue = max;
  const layout = o.layout as Record<string, unknown> | undefined;
  if (layout && typeof layout === "object") {
    const pos = (p: unknown): NodePos | undefined => {
      if (!p || typeof p !== "object") return undefined;
      const x = num((p as NodePos).x);
      const y = num((p as NodePos).y);
      return x !== undefined && y !== undefined ? { x, y } : undefined;
    };
    const trigger = pos(layout.trigger);
    const actions = Array.isArray(layout.actions) ? (layout.actions.map(pos).filter(Boolean) as NodePos[]) : undefined;
    cfg.layout = { trigger, actions };
  }
  return cfg;
}
