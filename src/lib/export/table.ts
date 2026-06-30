import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";

/**
 * Generic tabular exports (header row + string cells) to PDF / XLSX / Word.
 * Shared by the WhatsApp inbox and CRM exports so the file generation lives in
 * one place. Everything is server-only (pdf-lib / exceljs).
 */

export type ExportFormat = "pdf" | "xlsx" | "doc";

export type ExportTable = {
  title: string;
  headers: string[];
  rows: string[][];
};

const FORMATS: ExportFormat[] = ["pdf", "xlsx", "doc"];

/** Read a `format` query param, defaulting to pdf. */
export function parseFormat(raw: string | null): ExportFormat {
  return FORMATS.includes(raw as ExportFormat) ? (raw as ExportFormat) : "pdf";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}

/** Build the file + a downloadable Response for the given table and format. */
export async function exportResponse(table: ExportTable, format: ExportFormat): Promise<Response> {
  const filename = slugify(table.title);
  if (format === "xlsx") {
    const bytes = await toXlsxTable(table);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      },
    });
  }
  if (format === "doc") {
    return new Response(toDocTable(table), {
      headers: {
        "Content-Type": "application/msword; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.doc"`,
      },
    });
  }
  const bytes = await toPdfTable(table);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
    },
  });
}

// ── Word (.doc, Word-compatible HTML — no extra dependency) ──────────────────

function htmlEscape(s: string): string {
  return (s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

export function toDocTable({ title, headers, rows }: ExportTable): string {
  const ths = headers.map((h) => `<th>${htmlEscape(h)}</th>`).join("");
  const trs = rows
    .map((r) => `<tr>${headers.map((_, i) => `<td>${htmlEscape(r[i] ?? "")}</td>`).join("")}</tr>`)
    .join("");
  return (
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><title>${htmlEscape(title)}</title></head>` +
    `<body><h2>${htmlEscape(title)}</h2><p>${rows.length} registro(s)</p>` +
    `<table border="1" cellspacing="0" cellpadding="4"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>` +
    `</body></html>`
  );
}

// ── Excel (.xlsx, native) ────────────────────────────────────────────────────

export async function toXlsxTable({ title, headers, rows }: ExportTable): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MétodoAI";
  // Excel sheet names: max 31 chars, []:*?/\ not allowed.
  const sheetName = (title || "Export").replace(/[[\]:*?/\\]/g, " ").slice(0, 31);
  const ws = wb.addWorksheet(sheetName);

  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(headers.map((_, i) => r[i] ?? ""));

  headers.forEach((h, i) => {
    const longest = Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length), 8);
    ws.getColumn(i + 1).width = Math.min(longest + 2, 50);
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

// ── PDF (.pdf, pdf-lib) ──────────────────────────────────────────────────────

export async function toPdfTable({ title, headers, rows }: ExportTable): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Standard fonts are WinAnsi-encoded — drop glyphs they can't render (emojis…).
  const clean = (s: string) => (s ?? "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "").trim();

  const PAGE_W = 595.28;
  const PAGE_H = 841.89; // A4 portrait
  const margin = 40;
  const usable = PAGE_W - margin * 2;
  const n = Math.max(headers.length, 1);
  const colW = usable / n;
  const SIZE = 9;
  const ROW_H = 15;

  const truncate = (text: string, maxW: number, f: typeof font, size: number): string => {
    let t = clean(text);
    if (f.widthOfTextAtSize(t, size) <= maxW) return t;
    while (t.length && f.widthOfTextAtSize(`${t}...`, size) > maxW) t = t.slice(0, -1);
    return `${t}...`;
  };

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - margin;

  const drawCells = (cells: string[], f: typeof font, size: number) => {
    for (let i = 0; i < n; i++) {
      page.drawText(truncate(cells[i] ?? "", colW - 6, f, size), {
        x: margin + i * colW + 2,
        y,
        size,
        font: f,
      });
    }
  };

  const drawHeader = () => {
    drawCells(headers, bold, SIZE);
    y -= 4;
    page.drawLine({
      start: { x: margin, y },
      end: { x: PAGE_W - margin, y },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= ROW_H;
  };

  page.drawText(clean(title) || "Export", { x: margin, y, size: 14, font: bold });
  y -= 14;
  page.drawText(`${rows.length} registro(s)`, { x: margin, y, size: 9, font, color: rgb(0.45, 0.45, 0.45) });
  y -= 18;
  drawHeader();

  for (const row of rows) {
    if (y < margin) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - margin;
      drawHeader();
    }
    drawCells(row, font, SIZE);
    y -= ROW_H;
  }

  return pdf.save();
}
