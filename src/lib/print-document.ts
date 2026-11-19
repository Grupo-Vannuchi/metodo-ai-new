import "server-only";
import { createHash } from "node:crypto";

/**
 * The HTML documents the app serves itself as whole pages: the proposal (/api/proposals/[id]/document)
 * and the payslip (/api/hr/payroll/items/[id]/payslip). Both may carry the auto-print script below, and
 * both are served with DOCUMENT_CSP, which runs that script and no other.
 */

/** Opens the print dialog (Save as PDF) once the page has loaded. Change it here only: the CSP hashes it. */
const AUTO_PRINT_JS = "window.addEventListener('load',function(){setTimeout(function(){window.print();},250);});";

/** The auto-print `<script>` tag, byte for byte the source DOCUMENT_CSP allows. */
export const AUTO_PRINT_SCRIPT = `<script>${AUTO_PRINT_JS}</script>`;

const AUTO_PRINT_HASH = createHash("sha256").update(AUTO_PRINT_JS).digest("base64");

/**
 * Content-Security-Policy of those documents. No script but the auto-print one (by hash), no fetch,
 * frame, form, plugin or base change. Images from the app, over https or inline, and inline styles (the
 * documents carry their own `<style>` and `style` attributes).
 */
export const DOCUMENT_CSP = [
  "default-src 'none'",
  `script-src 'sha256-${AUTO_PRINT_HASH}'`,
  "style-src 'unsafe-inline'",
  "img-src 'self' https: data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

/** Headers for a document served as an HTML page. */
export function documentHtmlHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": DOCUMENT_CSP,
    "X-Content-Type-Options": "nosniff",
  };
}
