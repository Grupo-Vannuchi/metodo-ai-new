/**
 * Pure rendering for the mass e-mail: variable filling, the e-mail document
 * around the editor HTML and the plain-text alternative. Free of
 * `server-only` so scripts/check-email-broadcast.ts can run it; compose.ts
 * sanitizes the editor HTML BEFORE it reaches these functions.
 */

export type TemplateVars = { nome: string; empresa: string };

const VAR_RE = /\{\{\s*(nome|empresa)\s*\}\}/gi;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function lookup(vars: TemplateVars, key: string): string {
  return key.toLowerCase() === "empresa" ? vars.empresa : vars.nome;
}

/** Fill {{nome}}/{{empresa}} in (sanitized) HTML; values are HTML-escaped. */
export function fillHtmlVars(html: string, vars: TemplateVars): string {
  return html.replace(VAR_RE, (_match, key: string) => escapeHtml(lookup(vars, key)));
}

/** Fill variables in a plain-text header (the subject); line breaks are
 * removed so a value can't inject extra headers. */
export function fillTextVars(text: string, vars: TemplateVars): string {
  return text
    .replace(VAR_RE, (_match, key: string) => lookup(vars, key))
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/**
 * `"Name" <addr>` (always a quoted display name, so commas/specials stay valid per RFC 5322),
 * or just the bare address when there's no usable name. `fromEmail` is free text in the
 * connection, so an already formatted `Name <addr>` is reduced to its address first.
 */
export function formatFrom(fromName: string | null | undefined, fromEmail: string): string {
  const angle = /<([^>]+)>/.exec(fromEmail);
  const addr = (angle ? angle[1] : fromEmail).trim();
  const name = (fromName ?? "").replace(/[\r\n"\\]/g, "").trim();
  return name ? `"${name}" <${addr}>` : addr;
}

/** Plain-text alternative of the body (improves deliverability). */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when the editor HTML has something to send: visible text or an image. */
export function hasEmailContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}

/** Inline style every image gets: mail clients ignore most <style> rules, and
 * a fixed-width image would overflow the 600px card on phones. */
const EMAIL_IMG_STYLE = "max-width:100%;height:auto;border:0;display:block";

/**
 * Make the (already sanitized) images e-mail-safe: responsive inline style on
 * each <img>, and base64 images removed — Gmail and others block data: URIs,
 * so they'd only show up as a broken image.
 */
export function prepareEmailImages(html: string): string {
  return html.replace(/<img\b([^>]*?)\s*\/?>/gi, (_match, attrs: string) => {
    if (/\bsrc\s*=\s*"\s*data:/i.test(attrs)) return "";
    const style = attrs.match(/\bstyle="([^"]*)"/i);
    const styled = style
      ? attrs.replace(style[0], `style="${EMAIL_IMG_STYLE};${style[1]}"`)
      : `${attrs} style="${EMAIL_IMG_STYLE}"`;
    return `<img${styled} />`;
  });
}

/** The full HTML e-mail: 600px card, inline styles, and the mandatory footer
 * (sender org + unsubscribe link, LGPD). Footer copy is pt-BR in v1. */
export function buildEmailDocument(input: {
  bodyHtml: string;
  orgName: string;
  unsubscribeUrl: string;
}): string {
  const org = escapeHtml(input.orgName);
  const url = escapeHtml(input.unsubscribeUrl);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  .content p { margin: 0 0 14px; }
  .content h2 { font-size: 20px; margin: 0 0 12px; }
  .content h3 { font-size: 17px; margin: 0 0 10px; }
  .content ul, .content ol { margin: 0 0 14px; padding-left: 22px; }
  .content a { color: #1d4ed8; }
</style>
</head>
<body style="margin:0;padding:0;background:#f5f7fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;">
<tr><td class="content" style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0a0a0a;">${input.bodyHtml}</td></tr>
</table>
<p style="max-width:600px;margin:16px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#55657a;">Você recebeu este e-mail de ${org}. <a href="${url}" style="color:#55657a;">Não quero mais receber</a></p>
</td></tr>
</table>
</body>
</html>`;
}
