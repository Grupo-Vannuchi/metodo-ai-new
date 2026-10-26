import type { Workbook } from "exceljs";
import { isValidEmail, parseEmailList } from "./normalize";

/**
 * Spreadsheet import for the composer. The file is read in the browser
 * (exceljs, loaded on demand), so only the addresses (and, with the header
 * row, each one's name and company) reach the server, inside the audience
 * JSON. Client-safe and free of `server-only` on purpose:
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

/** Longest name or company kept from a row (they ride in the audience JSON, 5,000 of each at most). */
export const MAX_PERSON_TEXT = 100;

/** "xls" is recognized only to explain that the old binary format isn't read. */
export function spreadsheetKind(fileName: string): "xlsx" | "csv" | "xls" | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return ext === "xlsx" || ext === "csv" || ext === "xls" ? ext : null;
}

/** One cell as read from the file: its displayed text and, for a link, where it points. */
export type SheetCell = { text: string; link: string | null };

/** What fills {{nome}} and {{empresa}} for an imported address ("" when the row has none). */
export type PersonDetails = { name: string; company: string };

/** What one file yields: unique valid addresses in order, and what was skipped. */
export type SpreadsheetRead = {
  emails: string[];
  /** Each address's name and company, in the same order. Null when no sheet had the header row. */
  people: PersonDetails[] | null;
  invalid: number;
  duplicates: number;
};

const NO_PERSON: PersonDetails = { name: "", company: "" };

/**
 * Unique valid addresses in the order they're added. Tokens with "@" that
 * aren't valid count as invalid; words without "@" (headers, names) are
 * skipped silently. A repeated address keeps its first person.
 */
function collector() {
  const emails: string[] = [];
  const people: PersonDetails[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  return {
    add(text: string, person: PersonDetails = NO_PERSON) {
      for (const email of parseEmailList(text.replace(/"/g, " ").replace(/mailto:/gi, " "))) {
        if (!isValidEmail(email)) invalid++;
        else if (seen.has(email)) duplicates++;
        else {
          seen.add(email);
          emails.push(email);
          people.push(person);
        }
      }
    },
    result(withPeople: boolean): SpreadsheetRead {
      return { emails, people: withPeople ? people : null, invalid, duplicates };
    },
  };
}

/** Addresses found in cell texts (or a whole CSV text): unique, valid, in the order they appear. */
export function extractEmails(texts: Iterable<string>): { emails: string[]; invalid: number; duplicates: number } {
  const found = collector();
  for (const text of texts) found.add(text);
  const { emails, invalid, duplicates } = found.result(false);
  return { emails, invalid, duplicates };
}

/** The columns read from the header row, by their name without case, accents, spaces, ".", "-" or "_". */
type HeaderColumn = "email" | "nome" | "sobrenome" | "empresa";
const HEADER_COLUMNS: ReadonlySet<string> = new Set<HeaderColumn>(["email", "nome", "sobrenome", "empresa"]);

function headerColumn(text: string): HeaderColumn | null {
  const key = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
  return HEADER_COLUMNS.has(key) ? (key as HeaderColumn) : null;
}

/** Where each known column sits in the header row (the first one wins). Null without an "email" column. */
function headerMap(row: readonly SheetCell[]): Partial<Record<HeaderColumn, number>> | null {
  const map: Partial<Record<HeaderColumn, number>> = {};
  row.forEach((cell, i) => {
    const column = headerColumn(cell.text);
    if (column && map[column] === undefined) map[column] = i;
  });
  return map.email === undefined ? null : map;
}

/** A name or company as it goes into the e-mail: spaces and line breaks collapsed, capped. */
function personText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_PERSON_TEXT).trim();
}

/** A cell's text, plus its link target when the text isn't an address ("Escreva para a Bia"). */
function cellAddressText(cell: SheetCell): string {
  return cell.link && !cell.text.includes("@") ? `${cell.text} ${cell.link}` : cell.text;
}

/**
 * Every sheet of a file. When a sheet's first non-empty row has an "email"
 * column (see headerColumn), only that column gives addresses, and each one
 * takes {{nome}} from its row's nome + sobrenome and {{empresa}} from
 * empresa; other columns are ignored. A sheet without that row is read as
 * before: every address in every cell, with no name. `people` is null only
 * when no sheet had the row.
 */
export function readSheets(sheets: readonly (readonly SheetCell[])[][]): SpreadsheetRead {
  const found = collector();
  let withPeople = false;
  for (const rows of sheets) {
    const first = rows.findIndex((row) => row.some((cell) => cell.text.trim() !== ""));
    const map = first === -1 ? null : headerMap(rows[first]);
    if (!map) {
      for (const row of rows) row.forEach((cell) => found.add(cellAddressText(cell)));
      continue;
    }
    withPeople = true;
    const { email, nome, sobrenome, empresa } = map;
    for (const row of rows.slice(first + 1)) {
      const at = (i: number | undefined) => (i === undefined ? "" : (row[i]?.text ?? ""));
      const cell = email === undefined ? undefined : row[email];
      if (!cell) continue;
      found.add(cellAddressText(cell), {
        name: personText(`${at(nome)} ${at(sobrenome)}`),
        company: personText(at(empresa)),
      });
    }
  }
  return found.result(withPeople);
}

/** The separator a CSV's header line uses most, outside quotes: ",", ";" (Excel in Portuguese) or tab. */
function csvSeparator(text: string): string {
  const counts = new Map<string, number>([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best = ",";
  for (const [sep, n] of counts) if (n > (counts.get(best) ?? 0)) best = sep;
  return best;
}

/**
 * The rows of a CSV text. A field that starts with a quote may hold the
 * separator, line breaks and doubled quotes ("" → "). A leading BOM is dropped.
 */
export function csvRows(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const sep = csvSeparator(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * A .csv's bytes as text: UTF-8 when they are valid UTF-8, otherwise
 * Windows-1252, the encoding Excel in Portuguese uses for "CSV (separado
 * por vírgulas)". Read as UTF-8, its accented names would come out as "Jo�o".
 */
export function decodeCsv(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** A .csv: with the header row, as readSheets reads a sheet; without it, every address in the text, as before. */
export function readCsv(text: string): SpreadsheetRead {
  const mapped = readSheets([csvRows(text).map((row) => row.map((cell) => ({ text: cell, link: null })))]);
  return mapped.people ? mapped : { ...extractEmails([text]), people: null };
}

/**
 * The cells of every worksheet of an .xlsx, each at its column's position
 * (index = column number − 1; empty cells are holes). exceljs comes in as a
 * parameter: the browser loads it on demand, the check script imports it
 * directly. Rejects when the data isn't an .xlsx.
 */
export async function xlsxSheets(excel: { Workbook: new () => Workbook }, data: ArrayBuffer): Promise<SheetCell[][][]> {
  const wb = new excel.Workbook();
  await wb.xlsx.load(data);
  const sheets: SheetCell[][][] = [];
  wb.eachSheet((sheet) => {
    const rows: SheetCell[][] = [];
    sheet.eachRow((row) => {
      const cells: SheetCell[] = [];
      row.eachCell((cell, column) => {
        cells[column - 1] = { text: cell.text ?? "", link: cell.isHyperlink ? cell.hyperlink : null };
      });
      rows.push(cells);
    });
    sheets.push(rows);
  });
  return sheets;
}

/** The part of a new import that fits next to the `used` addresses already in the audience. */
export function fitImport(emails: readonly string[], used: number): { kept: string[]; dropped: number } {
  const room = Math.max(0, MAX_AUDIENCE_EMAILS - used);
  return { kept: emails.slice(0, room), dropped: Math.max(0, emails.length - room) };
}

/** An import without one address, and without that address's name and company. */
export function withoutEmail<T extends { emails: string[]; people?: PersonDetails[] }>(imp: T, email: string): T {
  const at = imp.emails.indexOf(email);
  if (at === -1) return imp;
  const keep = (_: unknown, i: number) => i !== at;
  return { ...imp, emails: imp.emails.filter(keep), ...(imp.people ? { people: imp.people.filter(keep) } : {}) };
}

/** Typed addresses plus every imported list, as counted against MAX_AUDIENCE_EMAILS. */
export function audienceEmailCount(sel: {
  emails: readonly string[];
  imports: readonly { emails: readonly string[] }[];
}): number {
  return sel.emails.length + sel.imports.reduce((sum, i) => sum + i.emails.length, 0);
}
