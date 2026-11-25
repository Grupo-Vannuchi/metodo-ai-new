/**
 * The phone cell of an imported spreadsheet, made into one number before the contact is written (src/app/actions/import-csv.ts).
 * Pure, so a check can run it. What address books really export (a Google Contatos file of 4.531 people had ~3,5% of these):
 *
 * - a WhatsApp id instead of a number ("5513999998888:61@c.us", "…@s.whatsapp.net"): the device suffix ":61" and the domain go
 *   before the digits are taken, or they become part of the number;
 * - two numbers in one cell ("(11) 98765-4321 / (11) 3333-4444", "… e …", "…; …", one per line, or just a space between them):
 *   one is kept, a mobile when there is one (the import is for WhatsApp), else the first; the caller counts how many had more;
 * - a trunk "0" in front, with or without a carrier code ("011 98765-4321", "0 15 11 98765-4321"): dropped, so the number is
 *   stored as "(11) 98765-4321" and not cut to "(01) 19876-5432";
 * - a foreign number ("+91 98765 43210"): kept as typed, since the Brazilian format would mangle it.
 */

export type ImportPhone = {
  /** Digits of a Brazilian number (with or without 55), or the foreign number as typed. */
  value: string;
  foreign: boolean;
  /** How many other numbers the cell had (dropped). */
  extra: number;
};

/** Separators between two numbers in one cell. Spaces are handled apart: a single number has them too. */
const SPLIT = /\s*(?:\/|,|;|\||\r?\n|\s+e\s+|\s+ou\s+)\s*/i;
/** "…:61@c.us", "…@s.whatsapp.net", "…@g.us", "…@lid". */
const JID = /(?::\d+)?@(?:c\.us|s\.whatsapp\.net|g\.us|lid)\s*$/i;

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** A part with more digits than one number holds, split at its spaces: tokens are grouped until they make a number. */
function splitGlued(part: string): string[] {
  if (digitsOf(part).length <= 13 || !/\s/.test(part)) return [part];
  const out: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const token of part.split(/\s+/)) {
    current.push(token);
    count += digitsOf(token).length;
    // 10 digits is the shortest Brazilian number with its area code (a landline); a mobile is 11, with 55 in front 12–13.
    if (count >= 10) {
      out.push(current.join(" "));
      current = [];
      count = 0;
    }
  }
  if (current.length > 0) out.push(current.join(" "));
  return out;
}

/** Brazilian digits without the trunk "0" and, after it, a carrier code. */
function brazilianDigits(d: string): string {
  if (!d.startsWith("0")) return d;
  const rest = d.replace(/^0+/, "");
  // 0 + carrier (2) + area code (2) + number (8 or 9): 12 or 13 digits once the 0 is gone, never starting with the country code.
  return (rest.length === 12 || rest.length === 13) && !rest.startsWith("55") ? rest.slice(2) : rest;
}

/** A Brazilian mobile: area code + 9 + 8 digits, with or without 55. */
function isMobile(d: string): boolean {
  const local = d.length === 13 && d.startsWith("55") ? d.slice(2) : d;
  return local.length === 11 && local[2] === "9";
}

export function normalizeImportPhone(raw: string): ImportPhone | null {
  const cell = (raw ?? "").trim().replace(JID, "");
  if (!/\d/.test(cell)) return null;

  const candidates = cell
    .split(SPLIT)
    .flatMap(splitGlued)
    .map((part) => part.trim())
    .filter((part) => /\d/.test(part))
    .map((part): Omit<ImportPhone, "extra"> => {
      const foreign = part.startsWith("+") && !part.startsWith("+55");
      return foreign ? { value: part, foreign } : { value: brazilianDigits(digitsOf(part)), foreign };
    });
  if (candidates.length === 0) return null;

  const pick = candidates.find((c) => !c.foreign && isMobile(c.value)) ?? candidates[0];
  return { ...pick, extra: candidates.length - 1 };
}
