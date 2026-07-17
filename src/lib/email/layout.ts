import "server-only";
import { env } from "@/lib/env";

/**
 * Branded HTML shell for transactional emails. Table-based + inline styles (the
 * only thing email clients render reliably), responsive up to 600px, the MÉTODO
 * logo (hosted image — data URIs are stripped by Gmail), brand palette
 * (#18375d / #2ecc71). Every transactional template is built on top of this.
 */

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type EmailButton = { label: string; url: string };

export type EmailLayoutInput = {
  /** Shown in the client's tab / subject preview line (hidden in the body). */
  preview: string;
  heading: string;
  /** Body paragraphs, already-safe HTML (built by the template, not user input). */
  bodyHtml: string;
  button?: EmailButton;
  /** Small print under the button (e.g. "o link expira em 24h"). */
  footnote?: string;
};

export function renderEmailLayout(input: EmailLayoutInput): string {
  const brand = "#18375d";
  const ink = "#0f172a";
  const muted = "#64748b";
  const line = "#e2e8f0";
  const year = 2026;

  const button = input.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
         <tr><td style="border-radius:10px;background:${brand};">
           <a href="${esc(input.button.url)}" target="_blank"
              style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
             ${esc(input.button.label)}
           </a>
         </td></tr>
       </table>`
    : "";

  const footnote = input.footnote
    ? `<p style="margin:0 0 8px;font-size:13px;color:${muted};line-height:1.5;">${esc(input.footnote)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(input.preview)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,.08);font-family:Segoe UI,Roboto,Arial,sans-serif;">
        <tr>
          <td style="background:${brand};padding:20px 32px;">
            <img src="${esc(env.NEXT_PUBLIC_SITE_URL)}/logo-white.png" alt="MétodoAI" width="142" height="32" style="display:block;border:0;height:32px;width:142px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${brand};">${esc(input.heading)}</h1>
            <div style="font-size:15px;line-height:1.6;color:${ink};">${input.bodyHtml}</div>
            ${button}
            ${footnote}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid ${line};">
            <p style="margin:0;font-size:12px;color:${muted};line-height:1.5;">
              Este é um e-mail automático do MétodoAI. Se você não esperava por ele, pode ignorá-lo com segurança.
            </p>
            <p style="margin:8px 0 0;font-size:12px;color:${muted};">© ${year} MétodoAI</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Turn plain paragraphs into safe body HTML (escaped + <p> wrapped). */
export function paragraphs(...lines: string[]): string {
  return lines
    .filter(Boolean)
    .map((l) => `<p style="margin:0 0 14px;">${esc(l)}</p>`)
    .join("");
}
