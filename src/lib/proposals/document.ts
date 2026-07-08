import "server-only";
import type { ProposalDocument } from "@/lib/validations/proposal-template";
import { sanitizeHtml } from "@/lib/proposals/sanitize";
import { substituteVars } from "@/lib/proposals/variables";

/**
 * Print-optimized HTML for a proposal (A4). Rendered by the export route; the
 * client either prints it to PDF (autoPrint) or downloads it as a Word (.doc).
 * Self-contained (inline CSS, no assets) so it works in a blank tab or Word.
 */

type DocItem = {
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type ProposalDoc = {
  code: string | null;
  title: string;
  clientCompany: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  clientAddress: string | null;
  intro: string | null;
  validUntil: Date | null;
  createdAt: Date;
  discount: number;
  subtotal: number;
  total: number;
  items: DocItem[];
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (n: number) => BRL.format(Number(n) || 0);

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape then turn newlines into <br> (for free-text intro). */
function escMultiline(value: string | null): string {
  return esc(value).replace(/\r?\n/g, "<br>");
}

function fmtDate(d: Date | null): string {
  return d ? new Date(d).toLocaleDateString("pt-BR") : "";
}

function clientRows(p: ProposalDoc): string {
  const rows: [string, string | null][] = [
    ["Empresa", p.clientCompany],
    ["Contato", p.clientName],
    ["E-mail", p.clientEmail],
    ["Telefone", p.clientPhone],
    ["Endereço", p.clientAddress],
  ];
  return rows
    .filter(([, v]) => String(v ?? "").trim())
    .map(([label, v]) => `<div class="client-row"><span class="k">${esc(label)}</span><span class="v">${esc(v)}</span></div>`)
    .join("");
}

export function renderProposalDocument(p: ProposalDoc, opts: { orgName: string; autoPrint?: boolean }): string {
  const docTitle = p.code ? `${p.code} — ${p.title}` : p.title;
  const itemsHtml = p.items.length
    ? p.items
        .map(
          (it) => `<tr>
            <td>
              <div class="it-name">${esc(it.name)}</div>
              ${it.description ? `<div class="it-desc">${escMultiline(it.description)}</div>` : ""}
            </td>
            <td class="num">${Number(it.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
            <td class="num">${brl(it.unitPrice)}</td>
            <td class="num">${brl(it.total)}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="empty">Sem itens.</td></tr>`;

  const discountRow =
    p.discount > 0
      ? `<div class="tot-row"><span>Desconto</span><span>− ${brl(p.discount)}</span></div>`
      : "";

  const autoPrint = opts.autoPrint
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},250);});</script>`
    : "";

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(docTitle)}</title>
<style>
  :root{--brand:#18375d;--accent:#2ecc71;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0}
  *{box-sizing:border-box}
  body{margin:0;background:#eef2f7;color:var(--ink);font:14px/1.55 Calibri,Segoe UI,Arial,sans-serif}
  .sheet{max-width:820px;margin:24px auto;background:#fff;box-shadow:0 18px 60px rgba(15,23,42,.12)}
  .head{background:var(--brand);color:#fff;padding:28px 40px;display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
  .head .org{font-size:20px;font-weight:800;letter-spacing:.01em}
  .head .meta{text-align:right;font-size:12.5px;line-height:1.5}
  .head .meta .tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.85}
  .head .meta .code{font-size:16px;font-weight:800;margin-top:2px}
  .body{padding:30px 40px 40px}
  h1.title{font-size:22px;margin:0 0 20px;color:var(--brand)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:26px}
  .card{border:1px solid var(--line);border-radius:12px;padding:16px 18px;background:#f8fafc}
  .card h3{margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .client-row{display:flex;gap:8px;font-size:13px;margin-bottom:4px}
  .client-row .k{min-width:78px;color:var(--muted)}
  .client-row .v{font-weight:600}
  .intro{white-space:normal;margin:0 0 26px;font-size:14px;color:#334155}
  table{width:100%;border-collapse:collapse;margin-bottom:8px}
  thead th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:2px solid var(--line);padding:10px 12px}
  thead th.num,tbody td.num{text-align:right}
  tbody td{padding:12px;border-bottom:1px solid var(--line);vertical-align:top}
  .it-name{font-weight:600}
  .it-desc{font-size:12px;color:var(--muted);margin-top:3px}
  td.empty{text-align:center;color:var(--muted);padding:22px}
  .totals{margin-left:auto;width:280px;margin-top:10px}
  .tot-row{display:flex;justify-content:space-between;padding:6px 0;font-size:14px;color:#334155}
  .tot-row.grand{border-top:2px solid var(--line);margin-top:6px;padding-top:12px;font-size:18px;font-weight:800;color:var(--brand)}
  .tot-row.grand span:last-child{color:#16a34a}
  .foot{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  @media print{@page{size:A4;margin:14mm}body{background:#fff}.sheet{max-width:none;margin:0;box-shadow:none}.head{padding:20px 4px}.body{padding:22px 4px}}
</style></head>
<body>
  <div class="sheet">
    <div class="head">
      <div class="org">${esc(opts.orgName)}</div>
      <div class="meta">
        <div class="tag">Proposta comercial</div>
        <div class="code">${esc(p.code ?? "")}</div>
        <div>${esc(fmtDate(p.createdAt))}</div>
      </div>
    </div>
    <div class="body">
      <h1 class="title">${esc(p.title)}</h1>
      <div class="grid">
        <div class="card">
          <h3>Cliente</h3>
          ${clientRows(p) || '<div class="client-row"><span class="v">—</span></div>'}
        </div>
        <div class="card">
          <h3>Validade</h3>
          <div class="client-row"><span class="k">Válida até</span><span class="v">${esc(fmtDate(p.validUntil) || "—")}</span></div>
        </div>
      </div>

      ${p.intro ? `<div class="intro">${escMultiline(p.intro)}</div>` : ""}

      <table>
        <thead><tr><th>Item</th><th class="num">Qtd.</th><th class="num">Valor unit.</th><th class="num">Total</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div class="totals">
        <div class="tot-row"><span>Subtotal</span><span>${brl(p.subtotal)}</span></div>
        ${discountRow}
        <div class="tot-row grand"><span>Total</span><span>${brl(p.total)}</span></div>
      </div>

      <div class="foot">
        <span>${esc(opts.orgName)}</span>
        <span>Documento gerado em ${esc(fmtDate(p.createdAt))}</span>
      </div>
    </div>
  </div>
  ${autoPrint}
</body></html>`;
}

// ------------------------------------------------------------ Rich (builder)

/** Substitute variables into a plain-text field, then escape for HTML. */
function textVar(value: string, vars: Record<string, string>): string {
  return esc(substituteVars(value, vars));
}

/** Substitute variables (values HTML-escaped) into a rich-text field, then
 * sanitize the whole thing against our allowlist. */
function htmlVar(value: string, vars: Record<string, string>): string {
  return sanitizeHtml(substituteVars(value, vars, esc));
}

/** An image band for the header/footer/signature, if it has content. */
function bandHtml(
  band: { imageUrl?: string; html?: string } | undefined,
  cls: string,
  vars: Record<string, string>,
): string {
  if (!band) return "";
  const img = band.imageUrl ? `<img src="${esc(band.imageUrl)}" alt="">` : "";
  const body = band.html ? htmlVar(band.html, vars) : "";
  if (!img && !body) return "";
  return `<div class="${cls}">${img}<div class="rt-band-html">${body}</div></div>`;
}

/**
 * Render a proposal's rich builder document (cover / header / footer / sections)
 * to print-ready A4 HTML, resolving {{variables}} from the proposal. Used by the
 * export route when the proposal carries a non-empty `document`.
 */
export function renderProposalBuilderDocument(
  doc: ProposalDocument,
  vars: Record<string, string>,
  opts: { orgName: string; title: string; code: string | null; createdAt: Date; autoPrint?: boolean },
): string {
  const docTitle = opts.code ? `${opts.code} — ${opts.title}` : opts.title;
  const city = doc.city ? substituteVars(doc.city, vars) : "";
  const dateStr = fmtDate(opts.createdAt);
  const cityDate = [city, dateStr, opts.code ?? ""].filter(Boolean).map(esc).join(" · ");

  const header = bandHtml(doc.header, "rt-header", vars);
  const footer = bandHtml(doc.footer, "rt-footer", vars);

  const coverImg = doc.cover?.imageUrl
    ? `<img class="cover-img" src="${esc(doc.cover.imageUrl)}" alt="">`
    : "";
  const subtitle = doc.cover?.subtitle ? `<div class="subtitle">${textVar(doc.cover.subtitle, vars)}</div>` : "";

  const sections = doc.sections
    .map(
      (s) => `<section class="doc-section">
        ${s.title ? `<h2>${textVar(s.title, vars)}</h2>` : ""}
        <div class="doc-html">${htmlVar(s.html ?? "", vars)}</div>
      </section>`,
    )
    .join("");

  const signature =
    doc.signature && (doc.signature.imageUrl || doc.signature.html)
      ? `<div class="signature">${
          doc.signature.imageUrl ? `<img src="${esc(doc.signature.imageUrl)}" alt="">` : ""
        }<div>${doc.signature.html ? htmlVar(doc.signature.html, vars) : ""}</div></div>`
      : "";

  const logos = doc.clientLogos.length
    ? `<div class="logos">${doc.clientLogos.map((u) => `<img src="${esc(u)}" alt="">`).join("")}</div>`
    : "";

  const autoPrint = opts.autoPrint
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},250);});</script>`
    : "";

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(docTitle)}</title>
<style>
  :root{--brand:#18375d;--accent:#2ecc71;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0}
  *{box-sizing:border-box}
  body{margin:0;background:#eef2f7;color:var(--ink);font:14px/1.6 Calibri,Segoe UI,Arial,sans-serif}
  .sheet{max-width:820px;margin:24px auto;background:#fff;box-shadow:0 18px 60px rgba(15,23,42,.12)}
  img{max-width:100%}
  .rt-header,.rt-footer{padding:12px 40px;color:var(--muted);font-size:12px;background:#fff}
  .rt-header{border-bottom:2px solid var(--brand);display:flex;align-items:center;gap:16px}
  .rt-footer{border-top:1px solid var(--line);text-align:center}
  .rt-header img,.rt-footer img{max-height:54px;width:auto}
  .rt-band-html{flex:1}
  .rt-band-html p{margin:0}
  .cover{padding:56px 40px;text-align:center;border-bottom:1px solid var(--line)}
  .cover .org{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--brand);font-weight:800}
  .cover h1{font-size:30px;color:var(--brand);margin:16px 0 8px;line-height:1.2}
  .cover .subtitle{color:var(--muted);font-size:15px}
  .cover .citydate{margin-top:18px;font-size:13px;color:var(--muted)}
  .cover .cover-img{max-height:280px;margin-top:24px;border-radius:12px}
  .body{padding:34px 40px 44px}
  .doc-section{margin-bottom:24px}
  .doc-section h2{font-size:14px;color:var(--brand);border-bottom:1px solid var(--line);padding-bottom:6px;margin:0 0 12px;text-transform:uppercase;letter-spacing:.04em}
  .doc-html{font-size:14px;color:#334155}
  .doc-html p{margin:0 0 8px}
  .doc-html img{border-radius:8px}
  .doc-html table{width:100%;border-collapse:collapse}
  .doc-html td,.doc-html th{border:1px solid var(--line);padding:8px}
  .signature{margin-top:44px;padding-top:12px}
  .signature img{max-height:90px;margin-bottom:6px}
  .logos{margin-top:30px;display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:center}
  .logos img{max-height:46px;width:auto}
  @media print{
    @page{size:A4;margin:22mm 15mm}
    body{background:#fff}
    .sheet{max-width:none;margin:0;box-shadow:none}
    .rt-header{position:fixed;top:0;left:0;right:0}
    .rt-footer{position:fixed;bottom:0;left:0;right:0}
    .cover{page-break-after:always}
    .doc-section{page-break-inside:avoid}
  }
</style></head>
<body>
  <div class="sheet">
    ${header}
    <div class="cover">
      <div class="org">${esc(opts.orgName)}</div>
      <h1>${textVar(opts.title, vars)}</h1>
      ${subtitle}
      <div class="citydate">${cityDate}</div>
      ${coverImg}
    </div>
    <div class="body">
      ${sections || `<p class="doc-html">${textVar("", vars)}</p>`}
      ${signature}
      ${logos}
    </div>
    ${footer}
  </div>
  ${autoPrint}
</body></html>`;
}
