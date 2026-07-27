/**
 * Client-safe automation vocabulary (no server imports) so both the rule editor
 * and the engine can share the shapes.
 */

export const TRIGGERS = ["stage_entered", "opportunity_won", "opportunity_lost"] as const;
export type TriggerType = (typeof TRIGGERS)[number];

export const ACTION_TYPES = ["create_task", "notify_owner", "send_whatsapp"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type RuleAction =
  | { type: "create_task"; title: string }
  | { type: "notify_owner" }
  | { type: "send_whatsapp"; templateId: string };

export function isTrigger(v: string): v is TriggerType {
  return (TRIGGERS as readonly string[]).includes(v);
}

/** Validate + normalize a raw actions array (from the form or the DB JSON). */
export function parseActions(raw: unknown): RuleAction[] {
  if (!Array.isArray(raw)) return [];
  const out: RuleAction[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const t = (a as { type?: unknown }).type;
    if (t === "create_task") {
      out.push({ type: "create_task", title: String((a as { title?: unknown }).title ?? "").slice(0, 160) });
    } else if (t === "notify_owner") {
      out.push({ type: "notify_owner" });
    } else if (t === "send_whatsapp") {
      const templateId = String((a as { templateId?: unknown }).templateId ?? "");
      if (templateId) out.push({ type: "send_whatsapp", templateId });
    }
  }
  return out.slice(0, 10);
}
