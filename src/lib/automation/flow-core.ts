import { parseMenuChoice } from "@/lib/automation/menu";
import type { FlowQuestion, FlowStep } from "@/lib/automation/types";

/**
 * Pure rules of the WhatsApp flow (no DB, no server imports): which questions
 * the conversation is on, whether a saved session still fits its rule, when
 * "any message" may start a flow, and what the opportunity gets.
 */

/** A session's answers: question index → reply, plus the menu choice. */
export type Answers = Record<string, string>;
/** The chosen option's index (0-based), as text. */
export const MENU_KEY = "menu";
/** The option's name when it was chosen, to notice a reorder or rename. */
export const MENU_LABEL_KEY = "menuLabel";

export const ANY_MESSAGE_QUIET_MS = 7 * 24 * 60 * 60 * 1000;
/** Inbound messages this close before the one that arrived are the same burst,
 *  not earlier activity. */
export const BURST_GRACE_MS = 10 * 60 * 1000;

export type ActivePath = {
  questions: FlowQuestion[];
  finalMessage?: string;
  choice?: { index: number; label: string };
};

/** The question list the conversation is on: the step's own questions, or the
 *  chosen option's; null while a menu still waits for its choice. */
export function activePath(step: FlowStep, answers: Answers): ActivePath | null {
  if (step.type === "ask_questions") {
    return { questions: step.questions, ...(step.finalMessage ? { finalMessage: step.finalMessage } : {}) };
  }
  const raw = answers[MENU_KEY];
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const index = Number(raw);
  const option = step.options[index];
  if (!option) return null;
  return {
    questions: option.questions,
    ...(option.finalMessage ? { finalMessage: option.finalMessage } : {}),
    choice: { index, label: option.label },
  };
}

/** False when the rule was edited under the session (step swapped, option
 *  reordered/renamed/removed, questions cut) so it can't go on sensibly. */
export function sessionFitsRule(step: FlowStep, answers: Answers): boolean {
  const chose = MENU_KEY in answers;
  const path = activePath(step, answers);
  if (step.type === "ask_questions") {
    if (chose) return false;
  } else if (!chose) {
    return !Object.keys(answers).some((k) => /^\d+$/.test(k));
  } else if (!path || path.choice?.label !== answers[MENU_LABEL_KEY]) {
    return false;
  }
  return path!.questions.some((_, i) => !answers[String(i)]);
}

/** The option a burst of replies picks: the last line that picks one. */
export function pickMenuChoice(lines: string[], labels: string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const choice = parseMenuChoice(lines[i], labels);
    if (choice !== null) return choice;
  }
  return null;
}

export type SessionStatus = "ACTIVE" | "COMPLETED" | "EXPIRED" | "HANDOFF" | "CANCELED";
export type AnyStartFacts = {
  arrivedAt: Date;
  assigned: boolean;
  /** Newest earlier message that counts as activity: any outbound, or an
   *  inbound more than BURST_GRACE_MS before arrivedAt. Null = new conversation. */
  lastActivityAt: Date | null;
  /** The newest session of THIS rule in the conversation. */
  lastSession: { status: SessionStatus; createdAt: Date } | null;
  /** A person (not the bot) wrote to the lead after lastSession began. */
  humanReplyAfterLastSession: boolean;
};

/** Whether a message may start an "any message" flow: never on an assigned
 *  conversation; yes on a new or 7-day-quiet one; yes when the lead abandoned
 *  this flow and nobody from the team has written since. */
export function canStartOnAnyMessage(f: AnyStartFacts): boolean {
  if (f.assigned) return false;
  if (!f.lastActivityAt || f.arrivedAt.getTime() - f.lastActivityAt.getTime() >= ANY_MESSAGE_QUIET_MS) return true;
  const s = f.lastSession;
  return !!s && (s.status === "EXPIRED" || s.status === "CANCELED") && !f.humanReplyAfterLastSession;
}

export function opportunityNotes(ruleName: string, path: ActivePath, answers: Answers): string {
  return [
    ...(path.choice ? [`Opção escolhida: ${path.choice.label}`] : []),
    ...path.questions.map((q, i) => `${q.label}: ${answers[String(i)] ?? "—"}`),
    `Origem: WhatsApp (automação "${ruleName}")`,
  ].join("\n");
}

export function opportunityTitle(ruleName: string, path: ActivePath, contactName: string | null): string {
  return path.choice
    ? `${ruleName} · ${path.choice.label} · ${contactName ?? ""}`
    : `${ruleName} · ${contactName ?? ""}`;
}
