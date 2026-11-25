/**
 * The column guess of "Importar CSV" (src/components/crm/csv-import.tsx): which header feeds which field. Pure and
 * client-safe, so a check can run it.
 *
 * Each field takes the best header still free, in the fields' order. A header named exactly like an alias wins, then one
 * with the alias as a whole word ("telefone comercial"), then one that only contains it ("email2"); one that also says
 * "value"/"valor" ("Phone 1 - Value") goes ahead of its look-alikes. Headers that describe another column, a label or a
 * type ("E-mail 1 - Label", "Phone 1 - Type") or a pronunciation ("Phonetic First Name": "phonetic" contains "phone"),
 * are never guessed. The person can still pick any column by hand.
 */

export type CsvField = { key: string; aliases: string[] };

/** Lowercase, no accents, anything that isn't a letter or digit becomes a single space. */
export function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const NEVER = /\b(phonetic|label|type|rotulo|tipo|yomi)\b/;
const VALUE = /\b(value|valor)\b/;

function score(header: string, aliases: string[]): number {
  if (NEVER.test(header)) return 0;
  const words = ` ${header} `;
  let best = 0;
  for (const a of aliases) {
    if (header === a) best = Math.max(best, 4);
    else if (words.includes(` ${a} `)) best = Math.max(best, 3);
    else if (header.includes(a)) best = Math.max(best, 1);
  }
  return best > 0 && VALUE.test(header) ? best + 1 : best;
}

/** The field each header goes to (null: not guessed), one header per field at most. */
export function autoMapColumns(fields: CsvField[], headers: string[]): (string | null)[] {
  const normalized = headers.map(normalizeHeader);
  const mapping: (string | null)[] = headers.map(() => null);
  for (const field of fields) {
    let pick = -1;
    let pickScore = 0;
    normalized.forEach((h, i) => {
      if (mapping[i] !== null) return;
      const s = score(h, field.aliases);
      // Ties keep the first column: the file's own order is the best guess left.
      if (s > pickScore) {
        pick = i;
        pickScore = s;
      }
    });
    if (pick >= 0) mapping[pick] = field.key;
  }
  return mapping;
}
