import { brPhoneKey } from "@/lib/phone";
import type { KeywordMatch } from "@/lib/automation/types";

/** Local BR digits of a phone plus its 8/9-digit twin: WhatsApp still registers
 *  some older mobiles without the 9th digit, so "13981427399" and the JID
 *  "551381427399" must be treated as the same number. */
function phoneVariants(raw: string): string[] {
  const key = brPhoneKey(raw);
  if (key.length === 11 && key[2] === "9") return [key, key.slice(0, 2) + key.slice(3)];
  if (key.length === 10) return [key, `${key.slice(0, 2)}9${key.slice(2)}`];
  return key ? [key] : [];
}

/** True when two phones (any format, with or without 55 / the 9th digit) match. */
export function samePhone(a: string, b: string): boolean {
  const va = phoneVariants(a);
  return phoneVariants(b).some((v) => va.includes(v));
}

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
