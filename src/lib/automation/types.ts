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
  "whatsapp_message",
] as const;
export type TriggerType = (typeof TRIGGERS)[number];

/** Triggers whose editor needs a stage picker. */
export function triggerNeedsStage(t: TriggerType): boolean {
  return t === "stage_entered";
}

/** The WhatsApp trigger has no opportunity until the flow creates one. */
export function isWhatsappTrigger(t: TriggerType): boolean {
  return t === "whatsapp_message";
}

export const ACTION_TYPES = [
  "ai_collect",
  "create_opportunity",
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

/** Actions that only make sense under the WhatsApp trigger. */
export const WHATSAPP_ONLY_ACTIONS: readonly ActionType[] = ["ai_collect", "create_opportunity"];

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";

/** Where a collected answer is stored when the flow finishes. */
export const QUESTION_FIELDS = ["name", "email", "notes"] as const;
export type QuestionField = (typeof QUESTION_FIELDS)[number];
export type FlowQuestion = { label: string; field: QuestionField };

export type RuleAction =
  | {
      type: "ai_collect";
      questions: FlowQuestion[];
      firstMessage?: string;
      instructions?: string;
      finalMessage?: string;
      allowHandoff?: boolean;
    }
  | { type: "create_opportunity" }
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

export type KeywordMatch = "contains" | "exact";
export type WhatsappTriggerConfig = {
  /** The Evolution connection (WhatsApp number) that receives the messages. */
  connectionId: string;
  /** Senders allowed to start the flow, stored as digits. */
  numbers: string[];
  keyword: string;
  match: KeywordMatch;
};

export type NodePos = { x: number; y: number };
export type RuleConfig = {
  /** Only fire when the opportunity's value is at least this. */
  minValue?: number;
  /** Only fire when the opportunity's value is at most this. */
  maxValue?: number;
  /** Canvas positions so the layout persists. */
  layout?: { trigger?: NodePos; actions?: NodePos[] };
  /** Filters of the "whatsapp_message" trigger. */
  whatsapp?: WhatsappTriggerConfig;
};

export function isTrigger(v: string): v is TriggerType {
  return (TRIGGERS as readonly string[]).includes(v);
}

export const MAX_FLOW_NUMBERS = 50;
export const MAX_FLOW_QUESTIONS = 15;

/** Digits of a phone typed by the user, or "" when it can't be a phone. */
export function cleanFlowNumber(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 10 && d.length <= 13 ? d : "";
}

export type RuleProblem = "name" | "actions" | "stage" | "connection" | "numbers" | "keyword" | "aiFirst" | "questions" | "whatsappOnly";

/** Why a rule can't be saved, or null. Shared by the editor and the server action. */
export function ruleProblem(rule: {
  name: string;
  trigger: TriggerType;
  triggerStageId?: string | null;
  actions: RuleAction[];
  config: RuleConfig;
}): RuleProblem | null {
  if (!rule.name.trim()) return "name";
  if (rule.actions.length === 0) return "actions";
  if (triggerNeedsStage(rule.trigger) && !rule.triggerStageId) return "stage";
  if (!isWhatsappTrigger(rule.trigger)) {
    return rule.actions.some((a) => WHATSAPP_ONLY_ACTIONS.includes(a.type)) ? "whatsappOnly" : null;
  }
  const wa = rule.config.whatsapp;
  if (!wa?.connectionId) return "connection";
  if (wa.numbers.length === 0) return "numbers";
  if (!wa.keyword.trim()) return "keyword";
  const [first, ...rest] = rule.actions;
  if (first.type !== "ai_collect" || rest.some((a) => a.type === "ai_collect")) return "aiFirst";
  if (first.questions.length === 0 || first.questions.some((q) => !q.label.trim())) return "questions";
  return null;
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
      case "ai_collect": {
        const questions: FlowQuestion[] = (Array.isArray(o.questions) ? o.questions : [])
          .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
          .map((q) => ({
            label: str(q.label, 160),
            field: QUESTION_FIELDS.includes(q.field as QuestionField) ? (q.field as QuestionField) : "notes",
          }))
          .slice(0, MAX_FLOW_QUESTIONS);
        out.push({
          type: "ai_collect",
          questions,
          firstMessage: str(o.firstMessage, 1000) || undefined,
          instructions: str(o.instructions, 4000) || undefined,
          finalMessage: str(o.finalMessage, 1000) || undefined,
          allowHandoff: o.allowHandoff === true,
        });
        break;
      }
      case "create_opportunity":
        out.push({ type: "create_opportunity" });
        break;
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
  const wa = o.whatsapp as Record<string, unknown> | undefined;
  if (wa && typeof wa === "object") {
    const numbers = [...new Set((Array.isArray(wa.numbers) ? wa.numbers : []).map((n) => cleanFlowNumber(String(n))))]
      .filter(Boolean)
      .slice(0, MAX_FLOW_NUMBERS);
    cfg.whatsapp = {
      connectionId: str(wa.connectionId, 64),
      numbers,
      keyword: str(wa.keyword, 60).trim(),
      match: wa.match === "exact" ? "exact" : "contains",
    };
  }
  return cfg;
}
