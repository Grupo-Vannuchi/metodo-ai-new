import type { KeywordMatch } from "@/lib/automation/types";

/** Lowercase, no accents, punctuation folded into single spaces. */
function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Does the message start the flow? "contains" needs the keyword as whole
 *  word(s) anywhere; "exact" needs the message to be only the keyword. */
export function keywordMatches(text: string, keyword: string, match: KeywordMatch): boolean {
  const k = normalizeText(keyword);
  if (!k) return false;
  const t = normalizeText(text);
  return match === "exact" ? t === k : ` ${t} `.includes(` ${k} `);
}
