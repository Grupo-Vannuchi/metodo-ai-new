/**
 * Self-check for the pure helpers of the mass e-mail module (no DB, no
 * network, no env). Run with `npm run check:email`; exits non-zero on the
 * first failure.
 *
 * Only modules WITHOUT `import "server-only"` can be imported here: outside
 * Next's bundler there is no `server-only` package to resolve.
 */
import assert from "node:assert/strict";
import { isValidEmail, normalizeEmail, parseEmailList } from "../src/lib/email-broadcast/normalize";
import { mergeCandidates, type Candidate } from "../src/lib/email-broadcast/audience-core";
import { transactionalRetryDelayMs } from "../src/lib/email/retry-after";
import {
  buildEmailDocument,
  fillHtmlVars,
  fillTextVars,
  formatFrom,
  hasEmailContent,
  htmlToText,
  prepareEmailImages,
} from "../src/lib/email-broadcast/render";
import { safeClickHref, safeImageSrc } from "../src/lib/email-broadcast/image-links";
import { batchFailureAction, singleFailureAction } from "../src/lib/email-broadcast/retry-policy";
import { hmacHex, safeEqual } from "../src/lib/email-broadcast/signing";
import {
  nextRecipientStatus,
  parseResendEvent,
  signSvix,
  suppressionFor,
  verifySvixSignature,
} from "../src/lib/email-broadcast/webhook";
import {
  domainOfEmail,
  isPlatformDomain,
  isSenderAllowed,
  normalizeDomain,
} from "../src/lib/email-broadcast/sender-domain";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- normalize ---------------------------------------------------------------
check("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  Ana.Souza@Exemplo.COM.br "), "ana.souza@exemplo.com.br");
});

check("isValidEmail accepts common addresses and rejects broken ones", () => {
  for (const ok of ["ana.souza@exemplo.com.br", "a+tag@x.io", "joao_lima@sub.dominio.com"]) {
    assert.ok(isValidEmail(ok), ok);
  }
  for (const bad of ["maria@@exemplo", "a@b", "x y@z.com", "@x.com", "sem-arroba", "a@-x.com", ""]) {
    assert.ok(!isValidEmail(bad), bad);
  }
});

check("parseEmailList splits on comma, semicolon, spaces and newlines", () => {
  assert.deepEqual(parseEmailList(" A@X.com, b@y.com;c@z.com\n d@w.com e@v.com "), [
    "a@x.com",
    "b@y.com",
    "c@z.com",
    "d@w.com",
    "e@v.com",
  ]);
});

check("parseEmailList keeps the address inside 'Name <addr>' and drops plain words", () => {
  assert.deepEqual(
    parseEmailList("João Lima <Joao@Exemplo.com.br>; Maria <maria@x.com>, sem-arroba, maria@@exemplo"),
    ["joao@exemplo.com.br", "maria@x.com", "maria@@exemplo"],
  );
});

// --- mergeCandidates -----------------------------------------------------------
check("mergeCandidates dedupes across sources and keeps the arithmetic", () => {
  const candidates: Candidate[] = [
    { email: "Carla@X.com ", source: "contact", name: "Carla", companyName: "Construtora", contactId: "c1" },
    { email: "carla@x.com", source: "company", name: "Construtora", companyName: "Construtora", companyId: "co1" },
    { email: "carla@x.com", source: "manual" },
    { email: "maria@@exemplo", source: "manual" },
    { email: "bloqueado@x.com", source: "manual" },
    { email: "contato@y.com", source: "company", name: "Y Ltda", companyName: "Y Ltda", companyId: "co2" },
  ];
  const { recipients, stats, invalidEmails } = mergeCandidates(candidates, new Set(["bloqueado@x.com"]));
  assert.deepEqual(stats, { selected: 6, invalid: 1, duplicates: 2, suppressed: 1, total: 2 });
  assert.equal(stats.selected - stats.invalid - stats.duplicates - stats.suppressed, stats.total);
  assert.deepEqual(invalidEmails, ["maria@@exemplo"]);
  assert.deepEqual(
    recipients.map((r) => r.email),
    ["carla@x.com", "contato@y.com"],
  );
  assert.deepEqual(recipients[0], {
    email: "carla@x.com",
    name: "Carla",
    companyName: "Construtora",
    sources: ["contact", "company", "manual"],
    contactId: "c1",
    companyId: "co1",
  });
});

check("mergeCandidates lets a contact's name win over an earlier manual entry", () => {
  const { recipients } = mergeCandidates(
    [
      { email: "a@x.com", source: "manual" },
      { email: "A@x.com", source: "contact", name: "Ana", companyName: "ACME", contactId: "c9" },
    ],
    new Set(),
  );
  assert.deepEqual(recipients, [
    { email: "a@x.com", name: "Ana", companyName: "ACME", sources: ["contact", "manual"], contactId: "c9", companyId: null },
  ]);
});

check("mergeCandidates with nothing selected yields zeros", () => {
  assert.deepEqual(mergeCandidates([], new Set()).stats, {
    selected: 0,
    invalid: 0,
    duplicates: 0,
    suppressed: 0,
    total: 0,
  });
});

// --- render --------------------------------------------------------------------
check("fillHtmlVars escapes values and accepts spacing/case variations", () => {
  assert.equal(
    fillHtmlVars("<p>Olá {{ nome }}, {{EMPRESA}}</p>", { nome: "<script>x</script>", empresa: "A&B" }),
    "<p>Olá &lt;script&gt;x&lt;/script&gt;, A&amp;B</p>",
  );
});

check("fillTextVars fills the subject and strips line breaks (header injection)", () => {
  assert.equal(fillTextVars("{{nome}}, oi\r\nBcc: x@y.com", { nome: "Ana", empresa: "" }), "Ana, oi Bcc: x@y.com");
});

check("formatFrom always quotes the name, strips header-breaking chars and uses the bare address", () => {
  assert.equal(formatFrom("Vannuchi, Moraes & Cia Ltda.", "contato@x.com"), '"Vannuchi, Moraes & Cia Ltda." <contato@x.com>');
  assert.equal(formatFrom("a@b", "contato@x.com"), '"a@b" <contato@x.com>');
  assert.equal(formatFrom("Acme", "ACME <contato@acme.com>"), '"Acme" <contato@acme.com>');
  assert.equal(formatFrom('Em"presa\\\r\nX', "contato@ex.com"), '"EmpresaX" <contato@ex.com>');
  assert.equal(formatFrom("  ", "contato@ex.com"), "contato@ex.com");
  assert.equal(formatFrom(null, " ACME <contato@ex.com> "), "contato@ex.com");
});

check("htmlToText keeps paragraphs, bullets and link targets", () => {
  assert.equal(
    htmlToText('<p>Olá <strong>Ana</strong></p><ul><li>Um</li><li>Dois</li></ul><p><a href="https://x.com">Ver</a></p>'),
    "Olá Ana\n• Um\n• Dois\nVer (https://x.com)",
  );
});

check("buildEmailDocument wraps the body and adds the escaped footer link", () => {
  const doc = buildEmailDocument({
    bodyHtml: "<p>Oi</p>",
    orgName: "A & B Ltda",
    unsubscribeUrl: "https://site.test/email-unsubscribe/r1/abc",
  });
  assert.ok(doc.includes("<p>Oi</p>"));
  assert.ok(doc.includes("A &amp; B Ltda"));
  assert.ok(doc.includes('href="https://site.test/email-unsubscribe/r1/abc"'));
});

// --- signing / webhook -----------------------------------------------------------
const SVIX_SECRET = "whsec_" + Buffer.from("check-email-broadcast-secret").toString("base64");
const SVIX_BODY = '{"type":"email.delivered","data":{"email_id":"e1"}}';

check("hmacHex is stable and safeEqual compares exactly", () => {
  const a = hmacHex("k", "email-broadcast-unsub:r1");
  assert.equal(a, hmacHex("k", "email-broadcast-unsub:r1"));
  assert.notEqual(a, hmacHex("k", "email-broadcast-unsub:r2"));
  assert.ok(safeEqual(a, a));
  assert.ok(!safeEqual(a, a.slice(1)));
});

check("verifySvixSignature accepts a valid signature among several", () => {
  const sig = signSvix(SVIX_SECRET, "msg_1", "1700000000", SVIX_BODY);
  assert.ok(
    verifySvixSignature({
      secret: SVIX_SECRET,
      id: "msg_1",
      timestamp: "1700000000",
      signature: `v1,AAAA ${sig}`,
      body: SVIX_BODY,
      nowSeconds: 1700000100,
    }),
  );
});

check("verifySvixSignature rejects tampered body, stale timestamp and missing headers", () => {
  const sig = signSvix(SVIX_SECRET, "msg_1", "1700000000", SVIX_BODY);
  const base = {
    secret: SVIX_SECRET,
    id: "msg_1",
    timestamp: "1700000000",
    signature: sig,
    body: SVIX_BODY,
    nowSeconds: 1700000100,
  };
  assert.ok(verifySvixSignature(base));
  assert.ok(!verifySvixSignature({ ...base, body: SVIX_BODY + " " }));
  assert.ok(!verifySvixSignature({ ...base, nowSeconds: 1700000000 + 301 }));
  assert.ok(!verifySvixSignature({ ...base, signature: null }));
  assert.ok(!verifySvixSignature({ ...base, id: null }));
});

check("parseResendEvent reads bounces and ignores unknown or incomplete events", () => {
  assert.deepEqual(
    parseResendEvent({
      type: "email.bounced",
      data: { email_id: "e1", bounce: { type: "Permanent", message: "Caixa inexistente" } },
    }),
    { type: "email.bounced", emailId: "e1", bouncePermanent: true, message: "Caixa inexistente" },
  );
  assert.equal(parseResendEvent({ type: "email.opened", data: { email_id: "e1" } }), null);
  assert.equal(parseResendEvent({ type: "email.delivered", data: {} }), null);
  assert.equal(parseResendEvent("lixo"), null);
});

check("status transitions only move forward", () => {
  assert.equal(nextRecipientStatus("SENT", "email.delivered"), "DELIVERED");
  assert.equal(nextRecipientStatus("BOUNCED", "email.delivered"), null);
  assert.equal(nextRecipientStatus("DELIVERED", "email.bounced"), "BOUNCED");
  assert.equal(nextRecipientStatus("FAILED", "email.complained"), null);
  assert.equal(nextRecipientStatus("QUEUED", "email.failed"), "FAILED");
  assert.equal(nextRecipientStatus("DELIVERED", "email.failed"), null);
});

check("only permanent bounces and complaints suppress the address", () => {
  const ev = (type: "email.bounced" | "email.complained" | "email.delivered", bouncePermanent: boolean) => ({
    type,
    emailId: "e",
    bouncePermanent,
    message: null,
  });
  assert.equal(suppressionFor(ev("email.bounced", true)), "BOUNCED");
  assert.equal(suppressionFor(ev("email.bounced", false)), null);
  assert.equal(suppressionFor(ev("email.complained", false)), "COMPLAINED");
  assert.equal(suppressionFor(ev("email.delivered", false)), null);
});

check("batchFailureAction follows the retry policy", () => {
  const C = "concurrent_idempotent_requests";
  assert.equal(batchFailureAction(409, C, 0), "retry_same_key");
  assert.equal(batchFailureAction(409, C, 4), "retry_same_key");
  assert.equal(batchFailureAction(409, C, 5), "pause");
  assert.equal(batchFailureAction(409, "invalid_idempotent_request", 0), "per_recipient");
  assert.equal(batchFailureAction(409, null, 0), "per_recipient");
  assert.equal(batchFailureAction(429, null, 4), "retry_same_key");
  assert.equal(batchFailureAction(429, null, 5), "pause");
  assert.equal(batchFailureAction(0, null, 2), "retry_same_key");
  assert.equal(batchFailureAction(0, null, 3), "pause");
  assert.equal(batchFailureAction(503, null, 2), "retry_same_key");
  assert.equal(batchFailureAction(500, null, 3), "pause");
  assert.equal(batchFailureAction(401, null, 0), "pause");
  assert.equal(batchFailureAction(403, null, 0), "pause");
  assert.equal(batchFailureAction(400, null, 0), "per_recipient");
  assert.equal(batchFailureAction(422, null, 0), "per_recipient");
  assert.equal(batchFailureAction(404, null, 0), "pause");
});

check("singleFailureAction follows the retry policy", () => {
  const C = "concurrent_idempotent_requests";
  assert.equal(singleFailureAction(409, C, 0), "retry_same_key");
  assert.equal(singleFailureAction(409, C, 5), "pause");
  assert.equal(singleFailureAction(409, "other", 0), "fail_recipient");
  assert.equal(singleFailureAction(429, null, 4), "retry_same_key");
  assert.equal(singleFailureAction(429, null, 5), "pause");
  assert.equal(singleFailureAction(0, null, 2), "retry_same_key");
  assert.equal(singleFailureAction(502, null, 3), "pause");
  assert.equal(singleFailureAction(401, null, 0), "pause");
  assert.equal(singleFailureAction(403, null, 0), "pause");
  assert.equal(singleFailureAction(400, null, 0), "fail_recipient");
  assert.equal(singleFailureAction(422, null, 0), "fail_recipient");
  assert.equal(singleFailureAction(404, null, 0), "fail_recipient");
});

// --- images ---------------------------------------------------------------------
const IMG_STYLE = "max-width:100%;height:auto;border:0;display:block";

check("prepareEmailImages makes sanitized images responsive, linked or not", () => {
  assert.equal(
    prepareEmailImages('<p><img src="https://cdn.x/a.png" alt="Promo" /></p>'),
    `<p><img src="https://cdn.x/a.png" alt="Promo" style="${IMG_STYLE}" /></p>`,
  );
  assert.equal(
    prepareEmailImages('<a href="https://loja.x"><img src="https://cdn.x/b.png" /></a>'),
    `<a href="https://loja.x"><img src="https://cdn.x/b.png" style="${IMG_STYLE}" /></a>`,
  );
});

check("prepareEmailImages keeps an existing style after the responsive base", () => {
  assert.equal(
    prepareEmailImages('<img src="https://cdn.x/c.png" style="margin: 0 auto" />'),
    `<img src="https://cdn.x/c.png" style="${IMG_STYLE};margin: 0 auto" />`,
  );
});

check("prepareEmailImages drops base64 images (mail clients block them)", () => {
  assert.equal(
    prepareEmailImages('<p>a<img src="data:image/png;base64,AAAA" alt="x" />b</p>'),
    "<p>ab</p>",
  );
});

check("safeImageSrc accepts only https image links", () => {
  assert.equal(safeImageSrc("  https://cdn.x/banner.png "), "https://cdn.x/banner.png");
  assert.equal(safeImageSrc("http://cdn.x/banner.png"), null);
  assert.equal(safeImageSrc("data:image/png;base64,AAAA"), null);
  assert.equal(safeImageSrc("javascript:alert(1)"), null);
  assert.equal(safeImageSrc("cdn.x/banner.png"), null);
  assert.equal(safeImageSrc(""), null);
});

check("safeClickHref accepts http(s) links, adds https:// to bare domains, rejects the rest", () => {
  assert.equal(safeClickHref("https://loja.x/promo"), "https://loja.x/promo");
  assert.equal(safeClickHref("http://loja.x"), "http://loja.x/");
  assert.equal(safeClickHref("loja.x/promo"), "https://loja.x/promo");
  assert.equal(safeClickHref("javascript:alert(1)"), null);
  assert.equal(safeClickHref("mailto:a@x.com"), null);
  assert.equal(safeClickHref("   "), null);
});

check("hasEmailContent counts text or an image as content", () => {
  assert.equal(hasEmailContent("<p>Oi</p>"), true);
  assert.equal(hasEmailContent('<p><img src="https://cdn.x/a.png"></p>'), true);
  assert.equal(hasEmailContent("<p> &nbsp; </p><p></p>"), false);
  assert.equal(hasEmailContent(""), false);
});

// --- sender domains ----------------------------------------------------------------
check("normalizeDomain lowercases, strips @ and trailing dot, rejects non-domains", () => {
  assert.equal(normalizeDomain(" @LojaXYZ.com.br. "), "lojaxyz.com.br");
  assert.equal(normalizeDomain("lojaxyz"), null);
  assert.equal(normalizeDomain("http://x.com"), null);
  assert.equal(normalizeDomain("a b.com"), null);
  assert.equal(normalizeDomain(""), null);
});

check("domainOfEmail returns the normalized domain of a valid address only", () => {
  assert.equal(domainOfEmail(" Contato@LojaXYZ.com.br "), "lojaxyz.com.br");
  assert.equal(domainOfEmail("sem-arroba"), null);
  assert.equal(domainOfEmail("maria@@x.com"), null);
});

check("isPlatformDomain matches metodotia.com and its subdomains only", () => {
  assert.equal(isPlatformDomain("metodotia.com"), true);
  assert.equal(isPlatformDomain("mail.metodotia.com"), true);
  assert.equal(isPlatformDomain("metodotia.com.br"), false);
  assert.equal(isPlatformDomain("xmetodotia.com"), false);
});

check("isSenderAllowed needs an exact allowed domain and never the platform's", () => {
  assert.equal(isSenderAllowed(" Promo@LojaXYZ.com.br ", ["lojaxyz.com.br"]), true);
  assert.equal(isSenderAllowed("a@outra.com", ["lojaxyz.com.br"]), false);
  assert.equal(isSenderAllowed("a@mail.lojaxyz.com.br", ["lojaxyz.com.br"]), false);
  assert.equal(isSenderAllowed("x@metodotia.com", ["metodotia.com"]), false);
  assert.equal(isSenderAllowed("", ["lojaxyz.com.br"]), false);
});

check("transactionalRetryDelayMs follows retry-after, capped at 2s, 1s by default", () => {
  assert.equal(transactionalRetryDelayMs(null), 1000);
  assert.equal(transactionalRetryDelayMs("0.5"), 500);
  assert.equal(transactionalRetryDelayMs("1"), 1000);
  assert.equal(transactionalRetryDelayMs("30"), 2000);
  assert.equal(transactionalRetryDelayMs("abc"), 1000);
  assert.equal(transactionalRetryDelayMs("-3"), 1000);
});

console.log(`\n✅ email-broadcast: ${passed} checks passed.`);
