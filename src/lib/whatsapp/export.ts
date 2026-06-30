import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { tenantDb } from "@/lib/tenant-db";
import { loadEvoCredsById } from "@/lib/integrations/evolution-creds";
import { findGroupInfo } from "@/lib/integrations/evolution-client";
import { formatBrPhone } from "@/lib/phone";

/**
 * WhatsApp inbox exports: the contact list (individual conversations) or a
 * group's members, rendered as PDF / XML / Word (.doc HTML). Just names +
 * numbers in a list.
 */

export type ExportRow = { name: string; number: string };
export type ExportFormat = "pdf" | "xml" | "doc";

// ── Data ────────────────────────────────────────────────────────────────────

/** All individual (non-group) conversations as name + number rows. */
export async function getContactRows(organizationId: string): Promise<ExportRow[]> {
  const db = tenantDb(organizationId);
  const convos = await db.conversation.findMany({
    where: { isGroup: false },
    orderBy: [{ lastMessageAt: "desc" }],
    take: 5000,
    select: { remoteJid: true, name: true, customName: true, contactId: true },
  });
  const contactIds = [...new Set(convos.map((c) => c.contactId).filter(Boolean))] as string[];
  const contacts = contactIds.length
    ? await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })
    : [];
  const cMap = new Map(contacts.map((c) => [c.id, c.name]));

  return convos.map((c) => {
    const digits = c.remoteJid.split("@")[0] ?? "";
    const number = formatBrPhone(digits) || digits;
    const name = c.customName || (c.contactId ? cMap.get(c.contactId) : null) || c.name || number;
    return { name, number };
  });
}

/** A group's participants as number rows (Evolution gives JIDs, not names). */
export async function getGroupRows(
  organizationId: string,
  conversationId: string,
): Promise<{ title: string; rows: ExportRow[] } | null> {
  const db = tenantDb(organizationId);
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, isGroup: true },
    select: { remoteJid: true, connectionId: true, name: true, customName: true },
  });
  if (!conv) return null;

  const creds = await loadEvoCredsById(conv.connectionId);
  const info = creds ? await findGroupInfo(creds, conv.remoteJid) : null;
  const title = conv.customName || conv.name || "Grupo";
  const rows: ExportRow[] = (info?.participants ?? []).map((p) => {
    const number = formatBrPhone(p.number) || p.number;
    return { name: p.admin ? `${number} (admin)` : number, number };
  });
  return { title, rows };
}

// ── Generators ───────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

export function toXml(title: string, rows: ExportRow[]): string {
  const items = rows
    .map((r) => `  <contact>\n    <name>${xmlEscape(r.name)}</name>\n    <number>${xmlEscape(r.number)}</number>\n  </contact>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<contacts title="${xmlEscape(title)}" count="${rows.length}">\n${items}\n</contacts>\n`;
}

/** Word-compatible HTML (.doc) — opens natively in MS Word, no extra dependency. */
export function toDoc(title: string, rows: ExportRow[]): string {
  const trs = rows
    .map((r) => `<tr><td>${xmlEscape(r.name)}</td><td>${xmlEscape(r.number)}</td></tr>`)
    .join("");
  return (
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><title>${xmlEscape(title)}</title></head>` +
    `<body><h2>${xmlEscape(title)}</h2>` +
    `<p>${rows.length} registro(s)</p>` +
    `<table border="1" cellspacing="0" cellpadding="4"><thead><tr><th>Nome</th><th>Número</th></tr></thead><tbody>${trs}</tbody></table>` +
    `</body></html>`
  );
}

export async function toPdf(title: string, rows: ExportRow[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // The standard fonts are WinAnsi-encoded — drop anything they can't render
  // (e.g. emojis) so pdf-lib doesn't throw.
  const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "").trim();

  const margin = 50;
  let page = pdf.addPage();
  let y = page.getHeight() - margin;

  page.drawText(safe(title) || "Export", { x: margin, y, size: 16, font: bold });
  y -= 26;
  page.drawText(`${rows.length} registro(s)`, { x: margin, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 22;

  for (const r of rows) {
    if (y < margin) {
      page = pdf.addPage();
      y = page.getHeight() - margin;
    }
    const line = r.name && r.name !== r.number ? `${r.name} — ${r.number}` : r.number;
    page.drawText(safe(line).slice(0, 95), { x: margin, y, size: 11, font });
    y -= 16;
  }
  return pdf.save();
}
