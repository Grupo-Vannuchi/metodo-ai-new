/** Signature preview isolated from the app: no scripts (sandbox=""), no CSS
 * leaking in or out. The report page already shows sent e-mails this way. */
export function SignaturePreview({ html, title, height = 160 }: { html: string; title: string; height?: number }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#0a0a0a;background:#ffffff}img{max-width:100%;height:auto}p{margin:0 0 8px}a{color:#1d4ed8}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      title={title}
      srcDoc={doc}
      sandbox=""
      className="w-full rounded-lg border border-border bg-white"
      style={{ height }}
    />
  );
}
