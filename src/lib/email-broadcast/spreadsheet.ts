import type { Workbook } from "exceljs";
import { isValidEmail, parseEmailList } from "./normalize";

/**
 * Spreadsheet import for the composer. The file is read in the browser
 * (exceljs, loaded on demand), so only the addresses reach the server, inside
 * the audience JSON. Client-safe and free of `server-only` on purpose:
 * scripts/check-email-broadcast.ts imports it directly.
 */

export const SPREADSHEET_ACCEPT = ".xlsx,.csv";

/** Bigger files are refused before parsing (the browser holds the whole file). */
export const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;

/** Cap on typed + imported addresses in one send; keeps the audience JSON well under the server action body limit. */
export const MAX_AUDIENCE_EMAILS = 5000;

/** Spreadsheets per send (each keeps its file name in the audience JSON). */
export const MAX_IMPORTS = 20;

/** Longest file name kept (the schema's limit). */
export const MAX_IMPORT_NAME = 255;

/** "xls" is recognized only to explain that the old binary format isn't read. */
export function spreadsheetKind(fileName: string): "xlsx" | "csv" | "xls" | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return ext === "xlsx" || ext === "csv" || ext === "xls" ? ext : null;
}

/**
 * Addresses found in cell texts (or a whole CSV text): unique, valid, in the
 * order they appear. Tokens with "@" that aren't valid count as invalid;
 * words without "@" (headers, names) are skipped silently.
 */
export function extractEmails(texts: Iterable<string>): { emails: string[]; invalid: number; duplicates: number } {
  const seen = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  for (const text of texts) {
    for (const email of parseEmailList(text.replace(/"/g, " ").replace(/mailto:/gi, " "))) {
      if (!isValidEmail(email)) invalid++;
      else if (seen.has(email)) duplicates++;
      else seen.add(email);
    }
  }
  return { emails: [...seen], invalid, duplicates };
}

/**
 * The displayed text of every cell in every worksheet of an .xlsx. A link
 * whose text isn't an address ("Escreva para a Bia") also yields its target.
 * exceljs comes in as a parameter: the browser loads it on demand, the check
 * script imports it directly. Rejects when the data isn't an .xlsx.
 */
export async function xlsxCellTexts(excel: { Workbook: new () => Workbook }, data: ArrayBuffer): Promise<string[]> {
  const wb = new excel.Workbook();
  await wb.xlsx.load(data);
  const out: string[] = [];
  wb.eachSheet((sheet) =>
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        const text = cell.text ?? "";
        out.push(text);
        if (cell.isHyperlink && !text.includes("@")) out.push(cell.hyperlink);
      }),
    ),
  );
  return out;
}

/** The part of a new import that fits next to the `used` addresses already in the audience. */
export function fitImport(emails: readonly string[], used: number): { kept: string[]; dropped: number } {
  const room = Math.max(0, MAX_AUDIENCE_EMAILS - used);
  return { kept: emails.slice(0, room), dropped: Math.max(0, emails.length - room) };
}

/** Typed addresses plus every imported list, as counted against MAX_AUDIENCE_EMAILS. */
export function audienceEmailCount(sel: {
  emails: readonly string[];
  imports: readonly { emails: readonly string[] }[];
}): number {
  return sel.emails.length + sel.imports.reduce((sum, i) => sum + i.emails.length, 0);
}
