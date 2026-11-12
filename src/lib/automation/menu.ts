import { normalizeText } from "@/lib/automation/match";

/**
 * The menu step's text, as the lead sees it on WhatsApp, and how a reply picks
 * an option. Client-safe: the editor shows the same text in its preview.
 */

export const INVALID_MENU_PREFIX = "Não entendi. Responda com o número de uma das opções:";

/** "1 - Evento X\n2 - Evento Y" */
export function menuList(labels: string[]): string {
  return labels.map((l, i) => `${i + 1} - ${l.trim()}`).join("\n");
}

export function formatMenu(question: string, labels: string[]): string {
  return `${question.trim()}\n\n${menuList(labels)}`;
}

export function invalidMenuReply(labels: string[]): string {
  return `${INVALID_MENU_PREFIX}\n\n${menuList(labels)}`;
}

const NUMBERED = /^(?:opcao |op |numero )?([1-9])$/;

/** The option (0-based) a reply picks, or null: the number with or without
 *  punctuation ("2.", "opção 2", "2️⃣"), or the option's name ("evento y",
 *  "2 evento y"). Anything else, two options included, picks nothing. */
export function parseMenuChoice(text: string, labels: string[]): number | null {
  const t = normalizeText(text.replace(/([0-9])️?⃣/g, "$1"));
  if (!t) return null;
  const n = NUMBERED.exec(t);
  if (n) {
    const i = Number(n[1]) - 1;
    return i < labels.length ? i : null;
  }
  const i = labels.findIndex((l, j) => {
    const name = normalizeText(l);
    return !!name && (t === name || t === `${j + 1} ${name}`);
  });
  return i === -1 ? null : i;
}
