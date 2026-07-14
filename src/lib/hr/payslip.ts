import "server-only";

/**
 * Print-optimized HTML for a payslip (holerite, A4). Same approach as the
 * proposal document: self-contained (inline CSS), printed to PDF by the browser
 * or downloaded as a .doc.
 */

export type PayslipLine = { type: "EARNING" | "DEDUCTION"; label: string; amount: number };

export type PayslipDoc = {
  employeeName: string;
  jobRoleName: string | null;
  document: string | null;
  documentType: string | null;
  bankName: string | null;
  pixKey: string | null;
  year: number;
  month: number;
  payDate: Date;
  baseSalary: number;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  lines: PayslipLine[];
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (n: number) => BRL.format(Number(n) || 0);

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const fmtDate = (d: Date) => new Date(d).toLocaleDateString("pt-BR");

/** Format a stored (digits-only) CPF/CNPJ for display. */
function fmtDoc(value: string | null, type: string | null): string {
  if (!value) return "";
  const d = value.replace(/\D+/g, "");
  if (type === "CPF" && d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  if (type === "CNPJ" && d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return value;
}

export function renderPayslip(p: PayslipDoc, opts: { orgName: string; autoPrint?: boolean }): string {
  const competencia = `${MONTHS[p.month - 1]} / ${p.year}`;
  const earnings = p.lines.filter((l) => l.type === "EARNING");
  const deductions = p.lines.filter((l) => l.type === "DEDUCTION");

  const rows = (list: PayslipLine[], sign: string) =>
    list.length
      ? list
          .map(
            (l) =>
              `<tr><td>${esc(l.label)}</td><td class="num">${sign}${brl(l.amount)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="2" class="empty">—</td></tr>`;

  const autoPrint = opts.autoPrint
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},250);});</script>`
    : "";

  const identity: [string, string][] = [
    ["Cargo", p.jobRoleName ?? "—"],
    [p.documentType ?? "Documento", fmtDoc(p.document, p.documentType) || "—"],
    ["Salário base", brl(p.baseSalary)],
    ["Pagamento", fmtDate(p.payDate)],
  ];

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(`Holerite ${String(p.month).padStart(2, "0")}/${p.year} — ${p.employeeName}`)}</title>
<style>
  :root{--brand:#18375d;--accent:#2ecc71;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0}
  *{box-sizing:border-box}
  body{margin:0;background:#eef2f7;color:var(--ink);font:14px/1.55 Calibri,Segoe UI,Arial,sans-serif}
  .sheet{max-width:760px;margin:24px auto;background:#fff;box-shadow:0 18px 60px rgba(15,23,42,.12)}
  .head{background:var(--brand);color:#fff;padding:24px 36px;display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
  .head .org{font-size:18px;font-weight:800}
  .head .meta{text-align:right;font-size:12.5px}
  .head .meta .tag{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.85}
  .head .meta .comp{font-size:15px;font-weight:800;margin-top:2px}
  .body{padding:28px 36px 36px}
  h1{font-size:20px;margin:0 0 4px;color:var(--brand)}
  .sub{color:var(--muted);font-size:13px;margin:0 0 20px}
  .ident{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;border:1px solid var(--line);border-radius:12px;padding:14px 18px;background:#f8fafc;margin-bottom:22px}
  .ident .row{display:flex;gap:8px;font-size:13px}
  .ident .k{min-width:92px;color:var(--muted)}
  .ident .v{font-weight:600}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  table{width:100%;border-collapse:collapse}
  caption{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding-bottom:6px;font-weight:700}
  td{padding:8px 10px;border-bottom:1px solid var(--line);font-size:13px}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td.empty{text-align:center;color:var(--muted)}
  tfoot td{border-bottom:none;border-top:2px solid var(--line);font-weight:700}
  .net{margin-top:24px;display:flex;justify-content:space-between;align-items:center;border-radius:12px;background:var(--brand);color:#fff;padding:16px 20px}
  .net .label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.85}
  .net .value{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums}
  .pay{margin-top:16px;font-size:12px;color:var(--muted)}
  .sign{margin-top:48px;display:grid;grid-template-columns:1fr 1fr;gap:40px;font-size:12px;color:var(--muted);text-align:center}
  .sign .line{border-top:1px solid var(--ink);padding-top:6px}
  @media print{@page{size:A4;margin:14mm}body{background:#fff}.sheet{max-width:none;margin:0;box-shadow:none}.head{padding:18px 4px}.body{padding:20px 4px}}
</style></head>
<body>
  <div class="sheet">
    <div class="head">
      <div class="org">${esc(opts.orgName)}</div>
      <div class="meta">
        <div class="tag">Recibo de pagamento</div>
        <div class="comp">${esc(competencia)}</div>
      </div>
    </div>
    <div class="body">
      <h1>${esc(p.employeeName)}</h1>
      <p class="sub">Competência ${esc(competencia)}</p>

      <div class="ident">
        ${identity
          .map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`)
          .join("")}
      </div>

      <div class="cols">
        <table>
          <caption>Proventos</caption>
          <tbody>${rows(earnings, "")}</tbody>
          <tfoot><tr><td>Total</td><td class="num">${brl(p.totalEarnings)}</td></tr></tfoot>
        </table>
        <table>
          <caption>Descontos</caption>
          <tbody>${rows(deductions, "− ")}</tbody>
          <tfoot><tr><td>Total</td><td class="num">− ${brl(p.totalDeductions)}</td></tr></tfoot>
        </table>
      </div>

      <div class="net">
        <span class="label">Líquido a receber</span>
        <span class="value">${brl(p.netPay)}</span>
      </div>

      ${
        p.bankName || p.pixKey
          ? `<p class="pay">Pagamento: ${esc([p.bankName, p.pixKey ? `PIX ${p.pixKey}` : ""].filter(Boolean).join(" · "))}</p>`
          : ""
      }

      <div class="sign">
        <div class="line">${esc(opts.orgName)}</div>
        <div class="line">${esc(p.employeeName)}</div>
      </div>
    </div>
  </div>
  ${autoPrint}
</body></html>`;
}
