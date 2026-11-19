/**
 * Self-check of the HTML documents the app serves as whole pages (proposal and payslip): the rich-text
 * sanitizer (src/lib/proposals/sanitize.ts, also used by the e-mail composer) and the Content-Security-
 * Policy those pages carry (src/lib/print-document.ts). No DB, no network, no env.
 *
 * Covers: markup that must never come out executable (no tag outside the allowlist, no event handler,
 * no script URL); the editor's ordinary output kept as it is; running the sanitizer twice changes
 * nothing; the CSP allows the auto-print script by its hash and nothing else; a rendered proposal with
 * hostile sections still carries only that script.
 *
 * Run: npm run check:documents   — exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sanitizeHtml } from "@/lib/proposals/sanitize";
import { AUTO_PRINT_SCRIPT, DOCUMENT_CSP } from "@/lib/print-document";
import { renderProposalBuilderDocument } from "@/lib/proposals/document";
import { emptyDocument } from "@/lib/validations/proposal-template";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const ALLOWED = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "hr", "span", "div", "a", "img", "table", "thead", "tbody", "tr", "th", "td",
]);

/** Every tag in the output is allowed, and none carries an event handler or a script URL. */
function assertInert(out: string, input: string): void {
  for (const t of out.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    assert.ok(ALLOWED.has(t[1].toLowerCase()), `tag <${t[1]}> from ${JSON.stringify(input)}`);
    assert.ok(!/\son[a-z]+\s*=/i.test(t[2]), `handler in ${JSON.stringify(out)}`);
    assert.ok(!/javascript:|vbscript:|&#/i.test(t[2]), `URL in ${JSON.stringify(out)}`);
  }
}

const HOSTILE = [
  "<<x>img src=x onerror=alert(1)>",
  "<p>a</p><img src=x onerror=alert(1) ",
  "<<x>script>alert(1)<</x>/script>",
  "<scr<script>x</script>ipt>alert(1)</script>",
  "<img/src=x/onerror=alert(1)>",
  "<img src=x onerror=alert(1) <p>b</p>",
  '<a href="javascript:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  "<svg onload=alert(1)>",
  "<iframe src=//x></iframe>",
  "<!--<img src=x onerror=alert(1)>-->",
  '<div style="background:url(javascript:alert(1))">x</div>',
  "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
];

check("hostile markup never comes out executable", () => {
  for (const input of HOSTILE) assertInert(sanitizeHtml(input), input);
});

check("a `<` that opens no complete allowed tag is written as text", () => {
  assert.equal(sanitizeHtml("<<x>img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)>");
  assert.equal(sanitizeHtml("<p>a</p><img src=x onerror=alert(1) "), "<p>a</p>&lt;img src=x onerror=alert(1) ");
  assert.equal(sanitizeHtml("<p>2 < 3</p>"), "<p>2 &lt; 3</p>");
});

check("the editor's ordinary output is kept", () => {
  const same = [
    "<p>Olá <strong>{{cliente}}</strong>, segue a <em>proposta</em>.</p>",
    '<p style="text-align: center">centro</p>',
    "<ul><li><p>a</p></li><li><p>b</p></li></ul>",
    '<p><span style="color: #ff0000">vermelho</span></p>',
    '<table><tbody><tr><td colspan="2">x</td></tr></tbody></table>',
  ];
  for (const html of same) assert.equal(sanitizeHtml(html), html);
  assert.equal(sanitizeHtml('<a href="https://x.com" target="_blank">l</a>'), '<a href="https://x.com">l</a>');
  assert.equal(sanitizeHtml('<img src="https://cdn.x/a.png" alt="logo">'), '<img src="https://cdn.x/a.png" alt="logo" />');
  assert.equal(sanitizeHtml("<h2>T</h2><hr><p>a<br>b</p>"), "<h2>T</h2><hr /><p>a<br />b</p>");
});

check("running the sanitizer twice changes nothing", () => {
  for (const html of [...HOSTILE, "<p>Olá <b>x</b></p>", '<img src="https://a/b.png">']) {
    assert.equal(sanitizeHtml(sanitizeHtml(html)), sanitizeHtml(html));
  }
});

check("the CSP allows the auto-print script by its hash, and no other script", () => {
  const body = /^<script>([\s\S]*)<\/script>$/.exec(AUTO_PRINT_SCRIPT)?.[1] ?? "";
  const hash = createHash("sha256").update(body).digest("base64");
  assert.ok(DOCUMENT_CSP.includes(`script-src 'sha256-${hash}'`), DOCUMENT_CSP);
  assert.ok(DOCUMENT_CSP.includes("default-src 'none'"));
  assert.ok(!/unsafe-inline[^;]*script|script-src[^;]*unsafe/.test(DOCUMENT_CSP));
});

check("a rendered proposal with hostile sections carries only the auto-print script", () => {
  const doc = emptyDocument();
  doc.sections = HOSTILE.map((html, i) => ({ id: `s${i}`, title: "t", html }));
  doc.header = { imageUrl: "", html: HOSTILE[0] };
  const html = renderProposalBuilderDocument(doc, { cliente: "<b>c</b>" }, {
    orgName: "Org",
    title: "Proposta",
    code: "P-1",
    createdAt: new Date(2026, 10, 19),
    autoPrint: true,
  });
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  assert.deepEqual(scripts, [AUTO_PRINT_SCRIPT]);
  assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html), "a tag with an event handler");
});

console.log(`\n✅ documents: ${passed} checks passed.`);
