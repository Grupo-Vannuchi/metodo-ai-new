/**
 * Minimal RFC-4180-ish CSV parser — no dependency. Handles quoted fields,
 * embedded commas/newlines, and doubled quotes (""). Detects the delimiter
 * (comma vs semicolon — Brazilian Excel exports commonly use `;`).
 *
 * Returns the header row plus data rows as arrays of strings. Field mapping to
 * entity fields happens in the UI.
 */

export type ParsedCsv = { headers: string[]; rows: string[][] };

function detectDelimiter(sample: string): "," | ";" | "\t" {
  // Look only at the first line, outside quotes, and pick the most frequent.
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const best = (Object.keys(counts) as ("," | ";" | "\t")[]).sort((a, b) => counts[b] - counts[a])[0];
  return counts[best] > 0 ? best : ",";
}

export function parseCsv(text: string): ParsedCsv {
  // Strip a UTF-8 BOM that Excel loves to prepend.
  const input = text.replace(/^﻿/, "");
  const delim = detectDelimiter(input);

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      // Swallow the \n of a \r\n pair.
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      // Skip fully blank lines.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  // Flush the trailing field/row (files without a final newline).
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }

  if (rows.length === 0) return { headers: [], rows: [] };
  const [headers, ...data] = rows;
  return { headers: headers.map((h) => h.trim()), rows: data };
}
