/**
 * Self-check for the pure helpers of the mass e-mail module (no DB, no
 * network, no env). Run with `npm run check:email`; exits non-zero on the
 * first failure.
 *
 * Only modules WITHOUT `import "server-only"` can be imported here: outside
 * Next's bundler there is no `server-only` package to resolve.
 */
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { isValidEmail, normalizeEmail, parseEmailList } from "../src/lib/email-broadcast/normalize";
import { mergeCandidates, type Candidate } from "../src/lib/email-broadcast/audience-core";
import { transactionalRetryDelayMs } from "../src/lib/email/retry-after";
import { buildMime } from "../src/lib/email-broadcast/microsoft/mime";
import {
  broadcastChannelOf,
  emailListHref,
  listChannelFromParam,
  listChannelOf,
} from "../src/lib/email-broadcast/list-channel";
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
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_BYTES,
  attachmentAddProblem,
  attachmentContentType,
  attachmentExtension,
  attachmentSizeParts,
  attachmentStorageKey,
  checkAttachments,
  cleanAttachmentName,
  estimateAttachmentSendMinutes,
  isAttachmentKeyOf,
  parseAttachments,
  readAttachments,
  type EmailAttachment,
} from "../src/lib/email-broadcast/attachments";
import {
  renderSignature,
  signatureContentFromForm,
  signatureContentOf,
  signatureImageSrc,
  signatureProblem,
  untilStable,
} from "../src/lib/email-broadcast/signature";
import {
  MAX_AUDIENCE_EMAILS,
  MAX_IMPORTS,
  audienceEmailCount,
  extractEmails,
  fitImport,
  spreadsheetKind,
  xlsxCellTexts,
} from "../src/lib/email-broadcast/spreadsheet";
import { EMPTY_AUDIENCE, audienceSelectionSchema } from "../src/lib/validations/email-broadcast";
import {
  INTERRUPTED_ERROR,
  failureMessageKey,
  googleRecipientError,
  listPausedMessageKey,
  listReason,
  microsoftRecipientError,
  pausedMessageKey,
  pausedReasonKey,
  recipientFailure,
  smtpRecipientError,
} from "../src/lib/email-broadcast/failure-reason";
import {
  MICROSOFT_CONSUMER_TENANT_ID,
  UPLOAD_CHUNK_BYTES,
  accountKindFromTid,
  attachmentUploadMode,
  graphFailureAction,
  microsoftConsentError,
  microsoftDailyLimit,
  microsoftSendPath,
  uploadRanges,
} from "../src/lib/email-broadcast/microsoft/core";
import {
  isReconnectCode,
  joinSiteUrl,
  mailboxPaceWaitMs,
  mailboxSendMinutes,
  remainingToday,
  sentLast24hWhere,
  sentLastHourWhere,
  waitChunksMs,
} from "../src/lib/email-broadcast/mailbox/core";
import {
  gmailFailureAction,
  gmailUploadMode,
  googleAccountKind,
  googleConsentError,
  googleDailyLimit,
  googleGrantedSend,
  googleHasGmail,
  pilotAllows,
} from "../src/lib/email-broadcast/google/core";
import {
  canKeepSmtpPassword,
  defaultSmtpSecurity,
  isSmtpSizeRefusal,
  smtpConnectError,
  smtpDailyLimit,
  smtpFailureAction,
  smtpFailureCode,
  smtpHourlyLimit,
  smtpPaceMs,
  smtpPhaseOf,
  smtpSendMinutes,
  smtpSendPhase,
} from "../src/lib/email-broadcast/smtp/core";
import { isBlockedSmtpAddress, pickSmtpAddress } from "../src/lib/email-broadcast/smtp/address";
import { smtpAccountSchema } from "../src/lib/validations/email-smtp-account";
import {
  attachmentDisposition,
  attachmentsFromGraph,
  cleanPreview,
  graphSearchValue,
  inboxBodyDocument,
  inboxFilterFromParam,
  inboxHref,
  inboxSearchFromParam,
  isGraphId,
  matchReplyToSend,
  microsoftTabFromParam,
  neutralizeOpeners,
  normalizeSubject,
  replaceCidImages,
  replyHtmlFromText,
  subjectAnswers,
  summaryFromGraph,
} from "../src/lib/email-broadcast/microsoft/inbox-core";

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

check("mergeCandidates tags spreadsheet addresses and orders them after manual ones", () => {
  const { recipients, stats } = mergeCandidates(
    [
      { email: "a@x.com", source: "spreadsheet" },
      { email: "A@x.com", source: "manual" },
      { email: "b@x.com", source: "spreadsheet" },
    ],
    new Set(),
  );
  assert.deepEqual(stats, { selected: 3, invalid: 0, duplicates: 1, suppressed: 0, total: 2 });
  assert.deepEqual(
    recipients.map((r) => [r.email, r.sources]),
    [
      ["a@x.com", ["manual", "spreadsheet"]],
      ["b@x.com", ["spreadsheet"]],
    ],
  );
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

// --- attachments -------------------------------------------------------------
const ORG = "cmorg1234567890abcdefghij";
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const att = (filename: string, size = 1000, org = ORG): EmailAttachment => ({
  key: attachmentStorageKey(org, UUID, filename),
  filename,
  size,
});

check("attachmentExtension accepts the closed list, any case, and rejects the rest", () => {
  assert.equal(attachmentExtension("Proposta.PDF"), "pdf");
  assert.equal(attachmentExtension("planilha.Xlsx"), "xlsx");
  assert.equal(attachmentExtension("foto.jpeg"), "jpeg");
  for (const bad of [
    "pacote.zip",
    "setup.exe",
    "macro.docm",
    "script.js",
    "semextensao",
    ".pdf",
    "fim.",
    "arquivo.pdf.exe",
    "x.constructor",
  ]) {
    assert.equal(attachmentExtension(bad), null, bad);
  }
});

check("attachmentContentType comes from the extension, never the browser", () => {
  assert.equal(attachmentContentType("a.PDF"), "application/pdf");
  assert.equal(attachmentContentType("b.csv"), "text/csv");
  assert.equal(attachmentContentType("c.zip"), null);
  assert.ok(ATTACHMENT_ACCEPT.split(",").includes(".docx"));
  assert.ok(!ATTACHMENT_ACCEPT.split(",").includes(".zip"));
});

check("cleanAttachmentName keeps accents, drops paths and control chars, caps at 150", () => {
  assert.equal(cleanAttachmentName("Catálogo Outubro.pdf"), "Catálogo Outubro.pdf");
  assert.equal(cleanAttachmentName("C:\\Users\\ana\\Proposta.docx"), "Proposta.docx");
  assert.equal(cleanAttachmentName("../../etc/relatorio.txt"), "relatorio.txt");
  assert.equal(cleanAttachmentName("  nome\u0007 com\tespaço .pdf "), "nome com espaço .pdf");
  const long = cleanAttachmentName(`${"a".repeat(200)}.PDF`);
  assert.equal(long?.length, 150);
  assert.ok(long?.endsWith(".PDF"));
  assert.equal(cleanAttachmentName("pacote.zip"), null);
  assert.equal(cleanAttachmentName("   "), null);
});

check("uppercase .ZIP is rejected", () => {
  assert.equal(attachmentExtension("pacote.ZIP"), null);
  assert.equal(cleanAttachmentName("pacote.ZIP"), null);
});

const EMOJI = String.fromCodePoint(0x1f600);
const BEL = String.fromCharCode(7);

check("cleanAttachmentName is idempotent for tricky names", () => {
  for (const x of [
    "a " + BEL + " b.pdf",
    `${"a".repeat(200)}.PDF`,
    "Catálogo Outubro.pdf",
    "a" + EMOJI.repeat(80) + ".pdf",
    "  nome" + BEL + " com" + String.fromCharCode(9) + "espaço .pdf ",
  ]) {
    const once = cleanAttachmentName(x);
    assert.ok(once !== null, x);
    assert.equal(cleanAttachmentName(once), once, x);
  }
});

check("cleanAttachmentName never cuts a surrogate pair at the 150 cap", () => {
  const r = cleanAttachmentName("a" + EMOJI.repeat(80) + ".pdf");
  assert.ok(r !== null);
  assert.ok(r.length <= 150, String(r.length));
  assert.ok(r.endsWith(".pdf"));
  for (let i = 0; i < r.length; i++) {
    const c = r.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = r.charCodeAt(i + 1);
      assert.ok(n >= 0xdc00 && n <= 0xdfff, `lone high surrogate at ${i}`);
      i++;
    } else {
      assert.ok(!(c >= 0xdc00 && c <= 0xdfff), `lone low surrogate at ${i}`);
    }
  }
});

check("attachmentStorageKey is ASCII-only, inside the org folder, and keeps the extension", () => {
  const key = attachmentStorageKey(ORG, UUID, "Catálogo de Preços (out).PDF");
  assert.equal(key, `email-attachments/${ORG}/${UUID}-Catalogo_de_Precos_out.pdf`);
  assert.ok(isAttachmentKeyOf(ORG, key));
  assert.equal(attachmentStorageKey(ORG, UUID, "###.pdf"), `email-attachments/${ORG}/${UUID}-arquivo.pdf`);
});

check("isAttachmentKeyOf only accepts this org's keys in the route's format", () => {
  const key = attachmentStorageKey(ORG, UUID, "a.pdf");
  assert.equal(isAttachmentKeyOf(ORG, key), true);
  assert.equal(isAttachmentKeyOf("outraorg", key), false);
  for (const bad of [
    `email-attachments/${ORG}/../outra/${UUID}-a.pdf`,
    `email-attachments/${ORG}/${UUID}-a.zip`,
    `email-attachments/${ORG}/nao-e-uuid-a.pdf`,
    `email/${ORG}/${UUID}-a.pdf`,
    `https://evil.example/${UUID}-a.pdf`,
    `email-attachments/${ORG}/sub/${UUID}-a.pdf`,
  ]) {
    assert.equal(isAttachmentKeyOf(ORG, bad), false, bad);
  }
  assert.equal(isAttachmentKeyOf("", `email-attachments//${UUID}-a.pdf`), false);
});

check("checkAttachments enforces count, type, key and the 10 MB total", () => {
  assert.equal(checkAttachments(ORG, []), null);
  assert.equal(checkAttachments(ORG, [att("a.pdf"), att("b.png")]), null);
  assert.equal(checkAttachments(ORG, Array.from({ length: 10 }, (_, i) => att(`f${i}.pdf`))), null);
  assert.equal(checkAttachments(ORG, Array.from({ length: 11 }, (_, i) => att(`f${i}.pdf`))), "count");
  assert.equal(checkAttachments(ORG, [{ ...att("a.pdf"), filename: "a.zip" }]), "type");
  assert.equal(checkAttachments(ORG, [{ ...att("a.pdf"), filename: "../a.pdf" }]), "type");
  assert.equal(checkAttachments(ORG, [att("a.pdf", 1000, "outraorg")]), "key");
  assert.equal(checkAttachments(ORG, [att("a.pdf", MAX_ATTACHMENTS_BYTES)]), null);
  assert.equal(checkAttachments(ORG, [att("a.pdf", MAX_ATTACHMENTS_BYTES), att("b.pdf", 1)]), "total");
});

check("attachmentAddProblem pre-checks a file before upload", () => {
  assert.equal(attachmentAddProblem([], { name: "a.pdf", size: 5 }), null);
  assert.equal(attachmentAddProblem([], { name: "a.zip", size: 5 }), "type");
  assert.equal(attachmentAddProblem([att("a.pdf", MAX_ATTACHMENTS_BYTES - 10)], { name: "b.pdf", size: 10 }), null);
  assert.equal(attachmentAddProblem([att("a.pdf", MAX_ATTACHMENTS_BYTES - 10)], { name: "b.pdf", size: 11 }), "total");
  assert.equal(attachmentAddProblem([], { name: "grande.pdf", size: MAX_ATTACHMENTS_BYTES + 1 }), "total");
  const ten = Array.from({ length: 10 }, (_, i) => att(`f${i}.pdf`, 1));
  assert.equal(attachmentAddProblem(ten, { name: "x.pdf", size: 1 }), "count");
});

check("parseAttachments returns null on broken JSON; readAttachments falls back to []", () => {
  const ok = [att("a.pdf")];
  assert.deepEqual(parseAttachments(ok), ok);
  assert.deepEqual(parseAttachments([]), []);
  assert.deepEqual(parseAttachments([{ ...ok[0], extra: true }]), ok);
  for (const bad of [
    null,
    "x",
    {},
    [{ key: "k", filename: "a.pdf" }],
    [{ key: "k", filename: "a.pdf", size: 1.5 }],
    [{ key: "k", filename: "a.pdf", size: 0 }],
    [ok[0], 7],
  ]) {
    assert.equal(parseAttachments(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(readAttachments([{ key: 1 }]), []);
  assert.deepEqual(readAttachments(ok), ok);
});

check("estimateAttachmentSendMinutes: ~2 e-mails/s, 0 means under a minute", () => {
  assert.equal(estimateAttachmentSendMinutes(0), 0);
  assert.equal(estimateAttachmentSendMinutes(1), 0);
  assert.equal(estimateAttachmentSendMinutes(119), 0);
  assert.equal(estimateAttachmentSendMinutes(120), 1);
  assert.equal(estimateAttachmentSendMinutes(179), 1);
  assert.equal(estimateAttachmentSendMinutes(180), 2);
  assert.equal(estimateAttachmentSendMinutes(1000), 8);
});

check("attachmentSizeParts shows KB under 1 MB and MB above", () => {
  assert.deepEqual(attachmentSizeParts(0), { value: 0, unit: "KB" });
  assert.deepEqual(attachmentSizeParts(1), { value: 1, unit: "KB" });
  assert.deepEqual(attachmentSizeParts(512 * 1024), { value: 512, unit: "KB" });
  assert.deepEqual(attachmentSizeParts(1024 * 1024), { value: 1, unit: "MB" });
  assert.deepEqual(attachmentSizeParts(4.25 * 1024 * 1024), { value: 4.3, unit: "MB" });
  assert.deepEqual(attachmentSizeParts(MAX_ATTACHMENTS_BYTES), { value: 10, unit: "MB" });
});

// --- signatures --------------------------------------------------------------
const IMG = "https://cdn.exemplo.com/assinatura.png";

check("renderSignature TEXT passes the html and derives the text part", () => {
  const r = renderSignature({ kind: "TEXT", html: "<p><strong>Ana</strong></p><p>(11) 3000-0000</p>" });
  assert.equal(r.html, "<p><strong>Ana</strong></p><p>(11) 3000-0000</p>");
  assert.equal(r.text, "Ana\n(11) 3000-0000");
});

check("renderSignature IMAGE builds the linked image and escapes everything", () => {
  const r = renderSignature({
    kind: "IMAGE",
    imageUrl: IMG,
    imageAlt: 'Ana "Diretora" <Comercial> & cia',
    imageHref: "www.suaempresa.com.br",
  });
  assert.equal(
    r.html,
    '<a href="https://www.suaempresa.com.br/"><img src="https://cdn.exemplo.com/assinatura.png" alt="Ana &quot;Diretora&quot; &lt;Comercial&gt; &amp; cia"></a>',
  );
  assert.equal(r.text, 'Ana "Diretora" <Comercial> & cia\nhttps://www.suaempresa.com.br/');
});

check("renderSignature IMAGE without a link is just the image", () => {
  const r = renderSignature({ kind: "IMAGE", imageUrl: IMG, imageAlt: "Ana", imageHref: null });
  assert.equal(r.html, '<img src="https://cdn.exemplo.com/assinatura.png" alt="Ana">');
  assert.equal(r.text, "Ana");
});

check("signatureImageSrc takes https or the app's own local media route only", () => {
  assert.equal(signatureImageSrc(IMG), IMG);
  assert.equal(signatureImageSrc("http://localhost:3000/api/media/email/x.png"), "http://localhost:3000/api/media/email/x.png");
  assert.equal(signatureImageSrc("http://evil.example/x.png"), null);
  assert.equal(signatureImageSrc("javascript:alert(1)"), null);
  assert.equal(signatureImageSrc(""), null);
  assert.equal(signatureImageSrc("http://evil.example/api/media/x.png"), null);
  assert.equal(signatureImageSrc("http://127.0.0.1:3000/api/media/email/x.png"), "http://127.0.0.1:3000/api/media/email/x.png");
});

check("signatureProblem flags what blocks a save", () => {
  assert.equal(signatureProblem({ kind: "TEXT", html: "<p>Ana</p>" }), null);
  assert.equal(signatureProblem({ kind: "TEXT", html: "<p></p>" }), "html_empty");
  assert.equal(signatureProblem({ kind: "TEXT", html: `<p>${"a".repeat(50_000)}</p>` }), "html_too_long");
  const ok = { kind: "IMAGE" as const, imageUrl: IMG, imageAlt: "Ana", imageHref: null };
  assert.equal(signatureProblem(ok), null);
  assert.equal(signatureProblem({ ...ok, imageUrl: "" }), "image_required");
  assert.equal(signatureProblem({ ...ok, imageUrl: "http://evil.example/x.png" }), "image_url");
  assert.equal(signatureProblem({ ...ok, imageAlt: "  " }), "alt_required");
  assert.equal(signatureProblem({ ...ok, imageAlt: "a".repeat(201) }), "line_too_long");
  assert.equal(signatureProblem({ ...ok, imageHref: "javascript:alert(1)" }), "href");
});

check("signatureContentFromForm trims and keeps only the chosen kind", () => {
  const base = { html: "<p>x</p>", imageUrl: ` ${IMG} `, imageAlt: " Ana ", imageHref: "  " };
  assert.deepEqual(signatureContentFromForm({ kind: "TEXT", ...base }), { kind: "TEXT", html: "<p>x</p>" });
  assert.deepEqual(signatureContentFromForm({ kind: "IMAGE", ...base }), {
    kind: "IMAGE",
    imageUrl: IMG,
    imageAlt: "Ana",
    imageHref: null,
  });
});

check("signatureContentOf reads a stored row", () => {
  const row = { kind: "IMAGE" as const, html: "", imageUrl: IMG, imageAlt: "Ana", imageHref: null };
  assert.deepEqual(signatureContentOf(row), { kind: "IMAGE", imageUrl: IMG, imageAlt: "Ana", imageHref: null });
  assert.deepEqual(signatureContentOf({ ...row, kind: "TEXT", html: "<p>a</p>" }), { kind: "TEXT", html: "<p>a</p>" });
});

check("untilStable reaches a fixed point and gives up on oscillation", () => {
  // A single-pass stripper splices a new tag together when it removes one.
  const strip = (s: string) => s.replace(/<x>/g, "");
  assert.equal(strip("<<x<x>>img>"), "<<x>img>");
  assert.equal(untilStable(strip, "<<x<x>>img>"), "<img>");
  assert.equal(strip("<<x>x>img>"), "<x>img>");
  assert.equal(untilStable(strip, "<<x>x>img>"), "img>");
  assert.equal(untilStable((s) => s + "a", "", 3), "");
  assert.equal(untilStable((s) => (s === "a" ? "b" : "a"), "a"), "");
  assert.equal(untilStable((s) => s, "abc"), "abc");
});

// --- spreadsheet import --------------------------------------------------------
check("spreadsheetKind reads the extension, case-insensitively", () => {
  assert.equal(spreadsheetKind("Clientes Evento.XLSX"), "xlsx");
  assert.equal(spreadsheetKind("lista.csv"), "csv");
  assert.equal(spreadsheetKind("antiga.xls"), "xls");
  assert.equal(spreadsheetKind("planilha.ods"), null);
  assert.equal(spreadsheetKind("sem-extensao"), null);
  assert.equal(spreadsheetKind("xlsx"), null);
});

check("extractEmails keeps unique valid addresses in order and counts the rest", () => {
  const r = extractEmails([
    "Nome",
    "E-mail",
    " Ana@Exemplo.com.br ",
    "joao@x.com; bia@y.com",
    "Maria <maria@z.com>",
    "ana@exemplo.com.br",
    "maria@@exemplo",
    "@instagram",
    "sem arroba",
    "",
  ]);
  assert.deepEqual(r.emails, ["ana@exemplo.com.br", "joao@x.com", "bia@y.com", "maria@z.com"]);
  assert.equal(r.duplicates, 1);
  assert.equal(r.invalid, 2);
});

check("extractEmails strips CSV quotes and mailto: links", () => {
  const csv = 'nome,email\n"Silva, Ana","ana@x.com"\nBia;mailto:bia@y.com\r\n"Caio"\t"caio@z.com"\n';
  assert.deepEqual(extractEmails([csv]).emails, ["ana@x.com", "bia@y.com", "caio@z.com"]);
  assert.deepEqual(extractEmails(["MAILTO:Dani@W.com"]).emails, ["dani@w.com"]);
});

check("fitImport keeps what fits under the cap and counts the rest", () => {
  assert.equal(MAX_AUDIENCE_EMAILS, 5000);
  assert.deepEqual(fitImport(["a@x.com", "b@x.com", "c@x.com"], 4998), { kept: ["a@x.com", "b@x.com"], dropped: 1 });
  assert.deepEqual(fitImport(["a@x.com"], 5000), { kept: [], dropped: 1 });
  assert.deepEqual(fitImport(["a@x.com"], 0), { kept: ["a@x.com"], dropped: 0 });
});

check("audienceEmailCount sums typed addresses and every imported list", () => {
  assert.equal(audienceEmailCount(EMPTY_AUDIENCE), 0);
  const sel = {
    ...EMPTY_AUDIENCE,
    emails: ["a@x.com"],
    imports: [
      { fileName: "a.xlsx", emails: ["b@x.com", "c@x.com"] },
      { fileName: "b.csv", emails: ["d@x.com"] },
    ],
  };
  assert.equal(audienceEmailCount(sel), 4);
});

check("audience schema keeps old drafts and caps typed + imported at 5,000", () => {
  const old = audienceSelectionSchema.parse({ allContacts: true, emails: ["a@x.com"] });
  assert.deepEqual(old.imports, []);
  const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}@x.com`);
  const at = { emails: many(1000, "m"), imports: [{ fileName: "a.xlsx", emails: many(4000, "s") }] };
  assert.ok(audienceSelectionSchema.safeParse(at).success);
  const over = { emails: many(1001, "m"), imports: [{ fileName: "a.xlsx", emails: many(4000, "s") }] };
  assert.ok(!audienceSelectionSchema.safeParse(over).success);
  assert.ok(!audienceSelectionSchema.safeParse({ imports: [{ fileName: "", emails: [] }] }).success);
  const files = (n: number) => Array.from({ length: n }, (_, i) => ({ fileName: `f${i}.csv`, emails: [`a${i}@x.com`] }));
  assert.equal(MAX_IMPORTS, 20);
  assert.ok(audienceSelectionSchema.safeParse({ imports: files(MAX_IMPORTS) }).success);
  assert.ok(!audienceSelectionSchema.safeParse({ imports: files(MAX_IMPORTS + 1) }).success);
});

// --- Microsoft channel ---------------------------------------------------------
check("accountKindFromTid tells a personal account from Microsoft 365", () => {
  assert.equal(accountKindFromTid(MICROSOFT_CONSUMER_TENANT_ID), "personal");
  assert.equal(accountKindFromTid(MICROSOFT_CONSUMER_TENANT_ID.toUpperCase()), "personal");
  assert.equal(accountKindFromTid("3a6f5659-ec46-4740-b69c-8eb97d2dd677"), "work");
  assert.equal(accountKindFromTid(undefined), "work");
});

check("microsoftDailyLimit and remainingToday", () => {
  assert.equal(microsoftDailyLimit("personal"), 300);
  assert.equal(microsoftDailyLimit("work"), 10_000);
  assert.equal(microsoftDailyLimit("anything"), 10_000);
  assert.equal(remainingToday(300, 120), 180);
  assert.equal(remainingToday(300, 300), 0);
  assert.equal(remainingToday(300, 450), 0);
  assert.equal(remainingToday(300, -5), 300);
});

check("sentLast24hWhere counts SENT, SENDING and UNCERTAIN of one account since 24 h ago", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const w = sentLast24hWhere("acc1", now);
  assert.deepEqual(w.status.in, ["SENT", "SENDING", "UNCERTAIN"]);
  assert.equal(w.sentAt.gte.toISOString(), "2026-10-14T12:00:00.000Z");
  assert.deepEqual(w.broadcast, { senderAccountId: "acc1" });
});

check("mailboxSendMinutes rounds up at ~28 per minute", () => {
  assert.equal(mailboxSendMinutes(0), 1);
  assert.equal(mailboxSendMinutes(28), 1);
  assert.equal(mailboxSendMinutes(29), 2);
  assert.equal(mailboxSendMinutes(300), 11);
});

check("waitChunksMs and mailboxPaceWaitMs split long waits under the lease", () => {
  assert.deepEqual(waitChunksMs(36_000), [10_000, 10_000, 10_000, 6_000]);
  assert.deepEqual(waitChunksMs(2_100), [2_100]);
  assert.deepEqual(waitChunksMs(0), []);
  assert.equal(mailboxPaceWaitMs(2_100, 0), 2_100);
  assert.equal(mailboxPaceWaitMs(36_000, 2), 72_000); // two sends of one account: each waits twice as long
  assert.equal(mailboxPaceWaitMs(2_100, 50), 42_000);
});

check("waitChunksMs fails closed: a pause that is not a number still waits one full piece", () => {
  assert.deepEqual(waitChunksMs(Number.NaN), [10_000]);
  assert.deepEqual(waitChunksMs(Number.POSITIVE_INFINITY), [10_000]);
  assert.deepEqual(waitChunksMs(Number.NEGATIVE_INFINITY), [10_000]);
  assert.deepEqual(waitChunksMs(Number.NaN, 4_000), [4_000]);
  // A pace computed from a broken limit (NaN) lands here too: never "no pause at all".
  assert.deepEqual(waitChunksMs(mailboxPaceWaitMs(Number.NaN, 3)), [10_000]);
  // Finite totals keep their meaning: nothing to wait is no piece.
  assert.deepEqual(waitChunksMs(-5), []);
});

check("microsoftSendPath goes direct only when the request fits", () => {
  assert.equal(microsoftSendPath(0, null), "direct");
  assert.equal(microsoftSendPath(0, 3_900_000), "direct");
  assert.equal(microsoftSendPath(0, 3_900_001), "draft");
  assert.equal(microsoftSendPath(2_200_000, 3_000_000), "direct");
  assert.equal(microsoftSendPath(2_200_001, null), "draft");
});

check("attachmentUploadMode and uploadRanges follow Graph's 3 MB / 320 KiB rules", () => {
  assert.equal(attachmentUploadMode(3 * 1024 * 1024 - 1), "inline");
  assert.equal(attachmentUploadMode(3 * 1024 * 1024), "session");
  assert.equal(UPLOAD_CHUNK_BYTES % (320 * 1024), 0);
  assert.ok(UPLOAD_CHUNK_BYTES < 4 * 1024 * 1024);
  assert.deepEqual(uploadRanges(10, 4), [
    { start: 0, end: 3 },
    { start: 4, end: 7 },
    { start: 8, end: 9 },
  ]);
  assert.deepEqual(uploadRanges(8, 4), [
    { start: 0, end: 3 },
    { start: 4, end: 7 },
  ]);
  assert.deepEqual(uploadRanges(0, 4), []);
});

check("graphFailureAction maps Graph answers to dispatcher moves", () => {
  assert.equal(graphFailureAction(401, "InvalidAuthenticationToken", 0, "send"), "refresh");
  assert.equal(graphFailureAction(401, null, 1, "send"), "reconnect");
  assert.equal(graphFailureAction(403, "ErrorAccessDenied", 0, "prepare"), "reconnect");
  assert.equal(graphFailureAction(403, "ErrorMessageSubmissionBlocked", 0, "send"), "blocked");
  assert.equal(graphFailureAction(403, "SomethingElse", 0, "send"), "pause");
  assert.equal(graphFailureAction(400, "ErrorExceededMessageLimit", 0, "send"), "daily_limit");
  assert.equal(graphFailureAction(429, null, 0, "send"), "retry");
  assert.equal(graphFailureAction(429, null, 5, "send"), "pause");
  assert.equal(graphFailureAction(503, null, 2, "send"), "retry");
  assert.equal(graphFailureAction(503, null, 3, "send"), "pause");
  assert.equal(graphFailureAction(0, null, 0, "send"), "uncertain");
  assert.equal(graphFailureAction(504, null, 0, "send"), "uncertain");
  assert.equal(graphFailureAction(500, null, 0, "send"), "uncertain");
  assert.equal(graphFailureAction(502, null, 0, "send"), "uncertain");
  assert.equal(graphFailureAction(503, null, 0, "send"), "retry");
  assert.equal(graphFailureAction(500, null, 0, "prepare"), "retry");
  assert.equal(graphFailureAction(0, null, 0, "prepare"), "retry");
  assert.equal(graphFailureAction(0, null, 3, "prepare"), "pause");
  assert.equal(graphFailureAction(413, null, 0, "prepare"), "pause");
  assert.equal(graphFailureAction(400, "ErrorMessageSizeExceeded", 0, "send"), "pause");
  assert.equal(graphFailureAction(400, "ErrorInvalidRecipients", 0, "send"), "recipient");
});

check("microsoftConsentError reads the provider's error", () => {
  assert.equal(microsoftConsentError("access_denied", "AADSTS65004: User declined to consent"), "cancelled");
  assert.equal(microsoftConsentError("access_denied", "AADSTS90094: admin approval required"), "admin_required");
  assert.equal(microsoftConsentError("consent_required", "AADSTS65001: needs consent"), "admin_required");
  assert.equal(microsoftConsentError("server_error", ""), "failed");
});

check("joinSiteUrl never doubles the slash", () => {
  assert.equal(
    joinSiteUrl("https://metodotia.com/", "/api/email/microsoft/callback"),
    "https://metodotia.com/api/email/microsoft/callback",
  );
  assert.equal(joinSiteUrl("https://metodotia.com", "api/x"), "https://metodotia.com/api/x");
  assert.equal(joinSiteUrl("http://localhost:3000//", "/api/x"), "http://localhost:3000/api/x");
});

check("isReconnectCode only for refusals a new consent fixes", () => {
  for (const c of ["invalid_grant", "interaction_required", "consent_required", "admin_policy_enforced"]) assert.equal(isReconnectCode(c), true);
  for (const c of ["invalid_client", "server_error", "temporarily_unavailable", ""]) assert.equal(isReconnectCode(c), false);
});

check("googleAccountKind and googleHasGmail read the hosted domain", () => {
  assert.equal(googleAccountKind("nillow.com"), "work");
  assert.equal(googleAccountKind(undefined), "personal");
  assert.equal(googleAccountKind(""), "personal");
  assert.equal(googleHasGmail("ana@gmail.com", undefined), true);
  assert.equal(googleHasGmail("Ana@GoogleMail.com", undefined), true);
  assert.equal(googleHasGmail("contato@nillow.com", "nillow.com"), true);
  assert.equal(googleHasGmail("contato@empresa.com.br", undefined), false);
});

check("googleGrantedSend, googleDailyLimit, gmailUploadMode, pilotAllows", () => {
  assert.equal(googleGrantedSend(["openid", "https://www.googleapis.com/auth/gmail.send"]), true);
  assert.equal(googleGrantedSend(["openid", "https://www.googleapis.com/auth/userinfo.email"]), false);
  assert.equal(googleDailyLimit("personal"), 500);
  assert.equal(googleDailyLimit("work"), 2_000);
  assert.equal(gmailUploadMode(5 * 1024 * 1024), "simple");
  assert.equal(gmailUploadMode(5 * 1024 * 1024 + 1), "resumable");
  assert.equal(pilotAllows("org1", undefined), true);
  assert.equal(pilotAllows("org1", ""), true);
  assert.equal(pilotAllows("org1", " org1 , org2"), true);
  assert.equal(pilotAllows("org3", "org1,org2"), false);
});

check("gmailFailureAction maps Gmail answers to dispatcher moves", () => {
  assert.equal(gmailFailureAction(401, "authError", "", 0, "send"), "refresh");
  assert.equal(gmailFailureAction(401, null, "", 1, "send"), "reconnect");
  assert.equal(gmailFailureAction(429, "rateLimitExceeded", "User-rate limit exceeded (Mail sending)", 0, "send"), "daily_limit");
  assert.equal(gmailFailureAction(429, null, "Too many concurrent requests for user", 0, "send"), "retry");
  assert.equal(gmailFailureAction(403, "userRateLimitExceeded", "", 0, "send"), "retry");
  assert.equal(gmailFailureAction(403, "rateLimitExceeded", "", 5, "send"), "pause");
  assert.equal(gmailFailureAction(403, "domainPolicy", "", 0, "send"), "blocked");
  assert.equal(gmailFailureAction(400, "failedPrecondition", "Mail service not enabled", 0, "send"), "blocked");
  assert.equal(gmailFailureAction(403, "dailyLimitExceeded", "", 0, "send"), "pause");
  assert.equal(gmailFailureAction(403, "insufficientPermissions", "", 0, "send"), "reconnect");
  assert.equal(gmailFailureAction(400, "badRequest", "Invalid To header", 0, "send"), "recipient");
  assert.equal(gmailFailureAction(400, "invalidArgument", "", 0, "send"), "recipient");
  assert.equal(gmailFailureAction(0, null, "", 0, "send"), "uncertain");
  assert.equal(gmailFailureAction(500, null, "", 0, "send"), "uncertain");
  assert.equal(gmailFailureAction(502, null, "", 0, "send"), "uncertain");
  assert.equal(gmailFailureAction(503, null, "", 2, "send"), "retry");
  assert.equal(gmailFailureAction(503, null, "", 3, "send"), "pause");
  assert.equal(gmailFailureAction(0, null, "", 0, "prepare"), "retry");
  assert.equal(gmailFailureAction(500, null, "", 3, "prepare"), "pause");
  assert.equal(gmailFailureAction(403, "accessNotConfigured", "", 0, "send"), "pause");
  assert.equal(gmailFailureAction(404, null, "", 0, "send"), "pause");
  assert.equal(gmailFailureAction(400, null, "", 0, "send"), "recipient");
  assert.equal(gmailFailureAction(500, "rateLimitExceeded", "", 0, "send"), "uncertain");
  assert.equal(gmailFailureAction(429, null, "", 5, "send"), "pause");
  assert.equal(gmailFailureAction(504, null, "", 0, "send"), "uncertain");
  // An ambiguous 5xx at the hand-over call is uncertain whatever reason it carries; prepare is a plain retry.
  assert.equal(gmailFailureAction(500, "failedPrecondition", "", 0, "send"), "uncertain");
  assert.equal(gmailFailureAction(502, "dailyLimitExceeded", "", 0, "send"), "uncertain");
  assert.equal(gmailFailureAction(500, "failedPrecondition", "", 0, "prepare"), "retry");
});

check("googleConsentError reads the provider's error", () => {
  assert.equal(googleConsentError("access_denied"), "cancelled");
  assert.equal(googleConsentError("admin_policy_enforced"), "admin_required");
  assert.equal(googleConsentError("server_error"), "failed");
});

// --- SMTP channel --------------------------------------------------------------
check("smtpPaceMs and smtpSendMinutes follow the hourly limit", () => {
  assert.equal(smtpPaceMs(100), 36_000);
  assert.equal(smtpPaceMs(1_700), 2_118);
  assert.equal(smtpPaceMs(5_000), 2_100);
  assert.equal(smtpPaceMs(1), 3_600_000);
  assert.equal(smtpSendMinutes(500, 100), 300);
  assert.equal(smtpSendMinutes(0, 100), 1);
  assert.equal(smtpSendMinutes(10, 1_700), 1);
  assert.equal(smtpDailyLimit({ dailyLimit: null }), 500);
  assert.equal(smtpDailyLimit({ dailyLimit: 800 }), 800);
  assert.equal(smtpHourlyLimit({ hourlyLimit: null }), 100);
  assert.equal(defaultSmtpSecurity(465), "ssl");
  assert.equal(defaultSmtpSecurity(587), "starttls");
  assert.equal(defaultSmtpSecurity(2525), "starttls");
});

check("smtpFailureAction maps SMTP answers to dispatcher moves", () => {
  const a = smtpFailureAction;
  assert.equal(a(0, "transfer", "Connection closed", 0), "uncertain");
  assert.equal(a(0, "connect", "ETIMEDOUT", 0), "retry");
  assert.equal(a(0, "connect", "ETIMEDOUT", 3), "pause");
  assert.equal(a(0, "guard", "", 0), "pause");
  assert.equal(a(0, "tls", "Hostname/IP does not match certificate's altnames", 0), "pause");
  assert.equal(a(535, "auth-535", "5.7.8 Authentication credentials invalid", 0), "reconnect");
  assert.equal(a(454, "auth-454", "4.7.0 Temporary authentication failure", 0), "retry");
  assert.equal(a(454, "auth-454", "4.7.0 Temporary authentication failure", 3), "pause");
  assert.equal(a(0, "noauth", "", 0), "pause");
  assert.equal(a(552, "message-552", "5.3.4 Message size exceeds fixed limit", 0), "recipient");
  assert.equal(a(0, "message", "Message size larger than allowed 10240000", 0), "recipient");
  // one recipient's address or mailbox: never a pause, even after the retries
  assert.equal(a(552, "rcpt-552", "5.2.2 Mailbox full", 0), "recipient");
  assert.equal(a(452, "rcpt-452", "4.2.2 Mailbox over quota", 0), "retry");
  assert.equal(a(452, "rcpt-452", "4.2.2 Mailbox over quota", 5), "recipient");
  assert.equal(a(550, "message-550", "5.1.1 Recipient rejected", 0), "recipient");
  assert.equal(a(450, "rcpt-450", "Mailbox unavailable", 4), "retry");
  assert.equal(a(450, "rcpt-450", "Mailbox unavailable", 5), "recipient");
  assert.equal(a(550, "rcpt-550", "5.1.1 User unknown", 0), "recipient");
  // a quota refusal with no enhanced code is still the mailbox's, unless its words say it is the sending limit
  assert.equal(a(552, "rcpt-552", "Sorry, the user's maildir has overdrawn his diskspace quota", 0), "recipient");
  assert.equal(a(452, "rcpt-452", "Over quota", 0), "retry");
  assert.equal(a(452, "rcpt-452", "Over quota", 5), "recipient");
  assert.equal(a(550, "rcpt-550", "Mailbox quota exceeded", 0), "recipient");
  assert.equal(a(552, "rcpt-552", "Quota excedida para o usuario", 0), "recipient");
  assert.equal(a(452, "message-452", "Mailbox over quota", 5), "recipient");
  assert.equal(a(450, "rcpt-450", "4.7.1 Too many recipients per hour", 0), "daily_limit");
  // a bare 552 at the final answer is a size, but with an address or mailbox code it is the recipient's
  assert.equal(a(552, "message-552", "5.2.3 Message length exceeds administrative limit", 0), "recipient");
  assert.equal(a(552, "message-552", "5.2.2 Mailbox full", 0), "recipient");
  // the account's own limit or sender
  assert.equal(a(550, "mail-550", "5.7.1 Sending rate limit exceeded", 0), "daily_limit");
  assert.equal(a(451, "rcpt-451", "Limite de envio excedido", 0), "daily_limit");
  assert.equal(a(550, "rcpt-550", "5.7.1 Daily sending quota exceeded", 0), "daily_limit");
  assert.equal(a(553, "mail-553", "5.7.1 Sender address rejected: not owned by user", 0), "blocked");
  assert.equal(a(553, "mail-553", "5.1.8 Sender address domain does not exist", 0), "blocked");
  // the sender or the relay refused on any command (Postfix says it at RCPT TO): the account's, not each recipient's
  assert.equal(a(553, "rcpt-553", "5.7.1 <a@b.com>: Sender address rejected: not owned by user", 0), "blocked");
  assert.equal(a(554, "rcpt-554", "5.7.1 Relay access denied", 0), "blocked");
  assert.equal(a(450, "rcpt-450", "4.1.8 <a@b.com>: Sender address rejected: Domain not found", 0), "blocked");
  assert.equal(a(550, "message-550", "5.7.1 generated content blocked", 0), "recipient"); // "generated" is not "rate"
  assert.equal(a(554, "message-554", "5.7.1 Message rejected as spam", 0), "recipient");
  assert.equal(a(554, "data-554", "Transaction failed", 0), "pause");
  assert.equal(a(421, "mail-421", "Service not available, closing channel", 0), "retry");
  assert.equal(a(421, "mail-421", "Service not available, closing channel", 5), "pause");
  assert.equal(a(0, null, "", 0), "pause");
});

check("canKeepSmtpPassword only reuses the saved password for the same server and user", () => {
  const saved = { host: "smtpi.kinghost.net", port: 587, security: "starttls" as const, username: "a@b.com", status: "ACTIVE" as const };
  const same = { host: "smtpi.kinghost.net", port: 587, security: "starttls" as const, username: "a@b.com" };
  assert.equal(canKeepSmtpPassword(saved, same), true);
  assert.equal(canKeepSmtpPassword(null, same), false);
  assert.equal(canKeepSmtpPassword({ ...saved, status: "NEEDS_RECONNECT" }, same), false);
  assert.equal(canKeepSmtpPassword(saved, { ...same, host: "smtp.atacante.com" }), false);
  assert.equal(canKeepSmtpPassword(saved, { ...same, port: 465 }), false);
  assert.equal(canKeepSmtpPassword(saved, { ...same, security: "ssl" }), false);
  assert.equal(canKeepSmtpPassword(saved, { ...same, username: "outro@b.com" }), false);
});

check("smtpSendPhase separates the preparation from the hand-over", () => {
  assert.equal(smtpSendPhase("connect", { code: "ETIMEDOUT" }), "connect");
  assert.equal(smtpSendPhase("connect", { code: "ESOCKET", message: "Hostname/IP does not match certificate's altnames" }), "tls");
  assert.equal(smtpSendPhase("connect", { code: "ESOCKET", message: "ssl3_get_record:wrong version number" }), "tls");
  assert.equal(smtpSendPhase("login", { code: "EAUTH" }), "auth");
  assert.equal(smtpSendPhase("login", { code: "ENOAUTH" }), "noauth");
  assert.equal(smtpSendPhase("login", { code: "ECONNECTION" }), "connect");
  assert.equal(smtpSendPhase("connect", { code: "EPROTOCOL" }), "connect");
  assert.equal(smtpSendPhase("login", { code: "EPROTOCOL" }), "connect");
  assert.equal(smtpSendPhase("send", { code: "EENVELOPE", command: "MAIL FROM" }), "mail");
  assert.equal(smtpSendPhase("send", { code: "EENVELOPE", command: "RCPT TO" }), "rcpt");
  assert.equal(smtpSendPhase("send", { code: "EENVELOPE", command: "DATA" }), "data");
  assert.equal(smtpSendPhase("send", { code: "EMESSAGE", command: "DATA" }), "message");
  assert.equal(smtpSendPhase("send", { code: "EMESSAGE", command: "MAIL FROM" }), "message");
  assert.equal(smtpSendPhase("send", { code: "ETIMEDOUT" }), "transfer");
  assert.equal(smtpSendPhase("send", { code: "ECONNECTION" }), "transfer");
  assert.equal(smtpSendPhase("send", {}), "transfer");
  assert.equal(smtpFailureCode("rcpt", 550), "rcpt-550");
  assert.equal(smtpFailureCode("transfer", null), "transfer");
  assert.equal(smtpPhaseOf("rcpt-550"), "rcpt");
  assert.equal(smtpPhaseOf("bogus"), null);
  assert.equal(smtpPhaseOf(null), null);
});

check("smtpConnectError names the save-form failures", () => {
  assert.equal(smtpConnectError({ code: "EAUTH", responseCode: 535 }), "auth_failed");
  assert.equal(smtpConnectError({ responseCode: 535 }), "auth_failed");
  assert.equal(smtpConnectError({ code: "ENOAUTH" }), "no_auth");
  assert.equal(smtpConnectError({ code: "ESOCKET", message: "self-signed certificate" }), "tls_failed");
  assert.equal(smtpConnectError({ code: "ETLS" }), "tls_failed");
  assert.equal(smtpConnectError({ code: "ESOCKET", message: "ssl3_get_record:wrong version number" }), "tls_failed");
  assert.equal(smtpConnectError({ code: "EDNS" }), "host_not_found");
  assert.equal(smtpConnectError({ code: "ENOTFOUND" }), "host_not_found");
  assert.equal(smtpConnectError({ code: "ETIMEDOUT", message: "Greeting never received" }), "connection_failed");
  assert.equal(smtpConnectError({ code: "ECONNECTION" }), "connection_failed");
  assert.equal(smtpConnectError({ code: "ECONNREFUSED" }), "connection_failed");
  assert.equal(smtpConnectError({ code: "EPROTOCOL", responseCode: 554 }), "connection_failed");
  assert.equal(smtpConnectError({}), "failed");
});

check("isBlockedSmtpAddress and pickSmtpAddress keep the server off internal networks", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip",
    // transition and deprecated ranges that can reach an internal IPv4 or an unrouted network
    "::7f00:1", "fec0::1", "feff::1", "2002:7f00:1::1", "2001::1", "192.88.99.1"]) assert.equal(isBlockedSmtpAddress(ip), true, ip);
  for (const ip of ["177.153.0.10", "8.8.8.8", "172.32.0.1", "2804:14c::1", "::ffff:8.8.8.8", "2001:4860:4860::8888"])
    assert.equal(isBlockedSmtpAddress(ip), false, ip);
  assert.deepEqual(pickSmtpAddress([]), { ok: false, error: "host_not_found" });
  assert.deepEqual(pickSmtpAddress([{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]), { ok: false, error: "host_not_allowed" });
  assert.deepEqual(pickSmtpAddress([{ address: "2001:4860:4860::8888", family: 6 }, { address: "8.8.4.4", family: 4 }]), { ok: true, ip: "8.8.4.4", family: 4 });
  assert.deepEqual(pickSmtpAddress([{ address: "2001:4860:4860::8888", family: 6 }]), { ok: true, ip: "2001:4860:4860::8888", family: 6 });
});

check("smtpAccountSchema validates and normalizes the SMTP form", () => {
  const ok = smtpAccountSchema.parse({ email: " Contato@Cliente.com.br ", displayName: "", host: " SMTPI.KingHost.net ",
    port: "587", security: "starttls", username: "", password: "x", hourlyLimit: "100", dailyLimit: "500" });
  assert.equal(ok.email, "contato@cliente.com.br");
  assert.equal(ok.host, "smtpi.kinghost.net");
  assert.equal(ok.port, 587);
  assert.equal(ok.username, "contato@cliente.com.br");
  assert.equal(ok.displayName, null);
  const base = { email: "a@b.com", host: "smtp.b.com", port: 465, security: "ssl", password: "x", hourlyLimit: 100, dailyLimit: 500 };
  for (const host of ["smtp://smtpi.kinghost.net", "smtpi.kinghost.net:587", "smtp kinghost.net", "localhost", ""])
    assert.equal(smtpAccountSchema.safeParse({ ...base, host }).success, false, host);
  for (const port of [25, 2526]) assert.equal(smtpAccountSchema.safeParse({ ...base, port }).success, false);
  for (const lim of [{ hourlyLimit: 0 }, { hourlyLimit: 1_701 }, { dailyLimit: 10_001 }, { hourlyLimit: 600, dailyLimit: 500 }])
    assert.equal(smtpAccountSchema.safeParse({ ...base, ...lim }).success, false, JSON.stringify(lim));
  assert.equal(smtpAccountSchema.safeParse({ ...base, password: "x".repeat(513) }).success, false);
  assert.equal(smtpAccountSchema.safeParse({ ...base, password: "" }).success, true); // the action decides whether the password is missing
});

// Edges and notations the guard and the form must hold, beyond the examples above.
check("smtpPaceMs and smtpSendMinutes stay sane at the edges", () => {
  assert.equal(smtpPaceMs(0), 3_600_000); // a zero or negative limit reads as one per hour
  assert.equal(smtpPaceMs(-5), 3_600_000);
  assert.equal(smtpPaceMs(1_714), 2_101);
  assert.equal(smtpPaceMs(1_715), 2_100); // from here on the mailbox pace is the floor
  assert.equal(smtpSendMinutes(-5, 100), 1);
  assert.equal(smtpSendMinutes(1, 1), 60);
  assert.equal(smtpSendMinutes(501, 100), 301);
});

check("smtpAccountSchema refuses a pasted URL and keeps what must stay as typed", () => {
  const base = { email: "a@b.com", host: "smtp.b.com", port: 587, security: "starttls", password: "x", hourlyLimit: 100, dailyLimit: 500 };
  const parse = (extra: Record<string, unknown>) => smtpAccountSchema.safeParse({ ...base, ...extra });
  assert.equal(parse({ host: " smtp://Smtpi.KingHost.net:587 " }).success, false);
  for (const host of ["177.153.0.10", "mail.example.com.br", "xn--80ak6aa92e.com", "SMTP.Gmail.com"])
    assert.equal(parse({ host }).success, true, host);
  for (const host of ["177.153.0.256", "010.0.0.1", "smtp.25", "a.b", "-x.example.com", "x-.example.com", "under_score.example.com",
    "smtp.example.com.", "2130706433", "[::1]", `${"x".repeat(250)}.com`])
    assert.equal(parse({ host }).success, false, host);
  for (const email of ["a@b", "a b@c.com", "", `${"x".repeat(250)}@b.com`]) assert.equal(parse({ email }).success, false, email);
  for (const port of ["", undefined, 587.5, "abc"]) assert.equal(parse({ port }).success, false, String(port));
  for (const lim of [{ hourlyLimit: 100.5 }, { hourlyLimit: "" }, { dailyLimit: undefined }])
    assert.equal(parse(lim).success, false, JSON.stringify(lim));
  for (const lim of [{ hourlyLimit: 1, dailyLimit: 1 }, { hourlyLimit: 500, dailyLimit: 500 }, { hourlyLimit: 1_700, dailyLimit: 10_000 }])
    assert.equal(parse(lim).success, true, JSON.stringify(lim));
  // the password is never trimmed; an explicit user is kept as typed (trimmed only); a name is trimmed
  // (`satisfies` pins the output types the save action relies on: tsc checks them, not the run)
  const typed = smtpAccountSchema.parse({ ...base, password: " p w ", username: " Contato ", displayName: "  Loja X  " });
  assert.equal(typed.password, " p w ");
  assert.equal(typed.username satisfies string, "Contato");
  assert.equal(typed.displayName satisfies string | null, "Loja X");
  assert.equal(typed.port satisfies 465 | 587 | 2525, 587);
  const bare = smtpAccountSchema.parse(base);
  assert.equal(bare.username, "a@b.com");
  assert.equal(bare.displayName, null);
});

check("isBlockedSmtpAddress holds at the edge of every range and in every notation", () => {
  // the first and the last address of every blocked range...
  const inside = [
    "0.0.0.0", "0.255.255.255", "10.0.0.0", "10.255.255.255", "100.64.0.0", "100.127.255.255", "127.0.0.0", "127.255.255.255",
    "169.254.0.0", "169.254.255.255", "172.16.0.0", "172.31.255.255", "192.0.0.0", "192.0.0.255", "192.0.2.0", "192.0.2.255",
    "192.168.0.0", "192.168.255.255", "198.18.0.0", "198.19.255.255", "198.51.100.0", "198.51.100.255", "203.0.113.0",
    "203.0.113.255", "224.0.0.0", "239.255.255.255", "240.0.0.0", "255.255.255.255", "192.88.99.0", "192.88.99.255",
    "::", "::1", "::ffff:ffff", "64:ff9b::", "64:ff9b::ffff:ffff", "100::", "100::ffff:ffff:ffff:ffff", "2001::",
    "2001:0:ffff:ffff::1", "2001:db8::", "2001:db8:ffff:ffff::1", "2002::", "2002:ffff::1", "fc00::", "fdff:ffff::1",
    "fe80::", "febf:ffff::1", "fec0::", "feff:ffff::1", "ff00::", "ffff::1",
  ];
  // ...and the address just past each range, which must stay open
  const outside = [
    "1.0.0.0", "9.255.255.255", "11.0.0.0", "100.63.255.255", "100.128.0.0", "126.255.255.255", "128.0.0.0", "169.253.255.255",
    "169.255.0.0", "172.15.255.255", "172.32.0.0", "192.0.1.0", "192.0.3.0", "192.88.98.255", "192.88.100.0", "192.167.255.255",
    "192.169.0.0", "198.17.255.255", "198.20.0.0", "198.51.99.255", "198.51.101.0", "203.0.112.255", "203.0.114.0",
    "223.255.255.255",
    "::1:0:0", "64:ff9a::1", "64:ff9c::1", "100:0:0:1::", "2001:1::1", "2001:db7::1", "2001:db9::1", "2001:ffff::1", "2003::1",
    "fbff::1", "fe00::1", "fe7f::1",
  ];
  for (const ip of inside) assert.equal(isBlockedSmtpAddress(ip), true, ip);
  for (const ip of outside) assert.equal(isBlockedSmtpAddress(ip), false, ip);
  for (const ip of ["::ffff:7f00:1", "::FFFF:7F00:1", "0:0:0:0:0:ffff:127.0.0.1", "::ffff:a00:1", "::ffff:c0a8:1",
    "::ffff:a9fe:a9fe", "::ffff:ac10:1", "::ffff:6440:1", "::ffff:c058:6301", "64:ff9b::7f00:1", "FD00::1", "ff02::1", "fe80::1%eth0",
    "2804:14c::1%eth0", "0:0:0:0:0:0:7f00:1", "::127.0.0.1", "2002:0a00:0001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2"])
    assert.equal(isBlockedSmtpAddress(ip), true, ip);
  for (const ip of ["::ffff:808:808", "::ffff:8.8.4.4", "2606:4700:4700::1111", "2a00:1450:4001::1", "2001:4860:4860::8888"])
    assert.equal(isBlockedSmtpAddress(ip), false, ip);
  // whatever isn't a plain IP is refused, never waved through
  for (const text of ["", " ", "8.8.8.8 ", "08.8.8.8", "010.0.0.1", "0177.0.0.1", "1.2.3", "1.2.3.4.5", "256.1.1.1", "localhost", "[::1]"])
    assert.equal(isBlockedSmtpAddress(text), true, JSON.stringify(text));
  // one internal answer refuses the whole name, whichever family it comes in
  assert.deepEqual(pickSmtpAddress([{ address: "fd00::1", family: 6 }, { address: "8.8.8.8", family: 4 }]), { ok: false, error: "host_not_allowed" });
  assert.deepEqual(pickSmtpAddress([{ address: "8.8.8.8", family: 4 }, { address: "::ffff:127.0.0.1", family: 6 }]), { ok: false, error: "host_not_allowed" });
  assert.deepEqual(pickSmtpAddress([{ address: "garbage", family: 4 }]), { ok: false, error: "host_not_allowed" });
});

check("TLS trouble is told apart in every shape it arrives, and only before the hand-over", () => {
  const tls = [
    { code: "ETLS" },
    { code: "EPROTO" },
    { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
    { code: "ESOCKET", message: "unable to verify the first certificate" },
    { code: "ESOCKET", message: "self signed certificate in certificate chain" },
    { code: "ESOCKET", message: "error:0A00010B:SSL routines:ssl3_get_record:wrong version number" },
  ];
  for (const e of tls) {
    assert.equal(smtpSendPhase("connect", e), "tls", JSON.stringify(e));
    assert.equal(smtpConnectError(e), "tls_failed", JSON.stringify(e));
  }
  assert.equal(smtpSendPhase("login", { code: "ETLS" }), "tls");
  // a refused connection is not TLS: it stays a retried connection failure
  assert.equal(smtpSendPhase("connect", { code: "ESOCKET", message: "connect ECONNREFUSED 1.2.3.4:587" }), "connect");
  assert.equal(smtpConnectError({ code: "ESOCKET", message: "connect ECONNREFUSED 1.2.3.4:587" }), "connection_failed");
  assert.equal(smtpConnectError({ code: "EAI_AGAIN" }), "host_not_found");
  assert.equal(smtpConnectError({ code: "ECONNRESET" }), "connection_failed");
  assert.equal(smtpConnectError({ code: "EAUTH", responseCode: 454 }), "auth_failed");
  // a server that doesn't greet like SMTP (EPROTOCOL) is a connection failure, even if its text mentions a certificate
  const greeting = { code: "EPROTOCOL", message: "Invalid greeting. response=554 5.7.1 client certificate required" };
  assert.equal(smtpSendPhase("connect", greeting), "connect");
  assert.equal(smtpSendPhase("login", greeting), "connect");
  assert.equal(smtpConnectError(greeting), "connection_failed");
  // during the hand-over a network failure is always uncertain, whatever words its text has
  assert.equal(smtpSendPhase("send", { code: "ESOCKET", message: "certificate" }), "transfer");
  assert.equal(smtpSendPhase("send", { code: "ESTREAM" }), "transfer");
  // an envelope refusal that names no known command still counts as the server saying no, not as uncertain
  assert.equal(smtpSendPhase("send", { code: "EENVELOPE", command: "API" }), "data");
  assert.equal(smtpSendPhase("send", { code: "EENVELOPE" }), "data");
  // the stored code survives the round trip
  assert.equal(smtpPhaseOf(smtpFailureCode("transfer", 0)), "transfer");
  assert.equal(smtpPhaseOf(smtpFailureCode("message", 552)), "message");
});

check("smtpFailureAction keeps a recipient's own refusals out of the pauses, whatever the wording", () => {
  const a = smtpFailureAction;
  // a RCPT TO failure with no reply code at all still never pauses
  assert.equal(a(0, "rcpt", "", 0), "recipient");
  // the recipient's own "rate" or "quota" is the recipient's, not the account's limit
  assert.equal(a(450, "rcpt-450", "4.2.1 The user is receiving mail at a rate that prevents additional messages", 0), "retry");
  assert.equal(a(450, "rcpt-450", "4.2.1 The user is receiving mail at a rate that prevents additional messages", 5), "recipient");
  assert.equal(a(552, "data-552", "5.2.2 Mailbox quota exceeded", 0), "recipient");
  assert.equal(a(451, "message-451", "4.2.2 Mailbox over quota", 4), "retry");
  assert.equal(a(451, "message-451", "4.2.2 Mailbox over quota", 5), "recipient");
  // x.7.x is the account's or the policy's, so the limit wording applies; at MAIL FROM a 5xx is the sender's
  assert.equal(a(550, "message-550", "5.7.1 Message rejected: rate limited", 0), "daily_limit");
  assert.equal(a(550, "mail-550", "5.1.1 Sender unknown", 0), "blocked");
  // a refused password reconnects, with or without a reply code
  assert.equal(a(530, "auth-530", "5.7.0 Authentication required", 0), "reconnect");
  assert.equal(a(0, "auth", "Invalid login", 0), "reconnect");
  // size, in the server's own words (a DATA refusal would pause if it were not read as size)
  assert.equal(a(552, "data-552", "Mensagem excede o tamanho máximo", 0), "recipient");
  assert.equal(a(554, "data-554", "Message too big", 0), "recipient");
  assert.equal(a(552, "mail-552", "5.3.4 Message size exceeds fixed limit", 0), "recipient");
  assert.equal(isSmtpSizeRefusal("message-552", ""), true);
  assert.equal(isSmtpSizeRefusal("message-552", "Message rejected"), true);
  assert.equal(isSmtpSizeRefusal("rcpt-552", "5.2.3 Message length exceeds administrative limit"), true);
  assert.equal(isSmtpSizeRefusal(null, "554 5.2.2 Message too large"), true);
  assert.equal(isSmtpSizeRefusal("message-552", "5.2.2 Mailbox full"), false);
  assert.equal(isSmtpSizeRefusal("message-552", "5.1.1 Recipient unknown"), false);
  assert.equal(isSmtpSizeRefusal("message-550", "Message rejected"), false);
  assert.equal(isSmtpSizeRefusal("rcpt-552", "5.2.2 Mailbox full"), false);
  assert.equal(isSmtpSizeRefusal("message-550", "5.7.1 generated content blocked"), false);
  assert.equal(isSmtpSizeRefusal(null, "host 15.3.45.2 blocked"), false); // 5.3.4 only counts as a whole status code
  // retry budgets: the preparation (connect, login) gets 3 retries, any other temporary answer 5
  assert.equal(a(0, "connect", "ETIMEDOUT", 2), "retry");
  assert.equal(a(454, "auth-454", "4.7.0 Temporary authentication failure", 2), "retry");
  assert.equal(a(421, "data-421", "4.3.2 Service shutting down", 4), "retry");
  assert.equal(a(421, "data-421", "4.3.2 Service shutting down", 5), "pause");
  // the sender or the relay refused on any command after the login: blocked, ahead of the size and recipient rules
  for (const phase of ["mail", "rcpt", "data", "message"]) {
    for (const text of ["Sender address rejected", "Mail is not owned by user", "Relay access denied", "Relaying denied"])
      assert.equal(a(554, `${phase}-554`, text, 0), "blocked", `${phase}: ${text}`);
    assert.equal(a(550, `${phase}-550`, "5.1.7 Bad sender's mailbox address syntax", 0), "blocked", phase);
    assert.equal(a(450, `${phase}-450`, "4.1.8 Bad sender's system address", 0), "blocked", phase);
  }
  assert.equal(a(552, "message-552", "Relay access denied", 0), "blocked"); // not read as a bare 552 size
  assert.equal(a(554, null, "Relay access denied", 0), "pause"); // only the answers after the login count
  // a limit word is the account's when a sending word comes with it (each of them), the mailbox's when none does
  for (const word of ["rate", "send", "sending", "sender", "sent", "envio", "envios", "enviar", "hour", "hourly", "day", "daily",
    "hora", "horas", "dia", "diario", "diário"])
    assert.equal(a(552, "rcpt-552", `Quota exceeded: ${word}`, 0), "daily_limit", word);
  assert.equal(a(552, "rcpt-552", "5.7.1 Mailbox quota exceeded", 0), "daily_limit"); // x.7.x is policy, not the mailbox
  assert.equal(a(552, "data-552", "Over quota", 0), "recipient");
  assert.equal(a(452, "data-452", "Over quota", 0), "retry");
  assert.equal(a(552, "mail-552", "Over quota", 0), "daily_limit"); // at MAIL FROM it is the sender's own quota
});

// --- failure reasons -----------------------------------------------------------
check("pausedReasonKey keeps known reasons and folds the rest into provider_error", () => {
  assert.equal(pausedReasonKey("daily_limit"), "daily_limit");
  assert.equal(pausedReasonKey("quota"), "quota");
  assert.equal(pausedReasonKey("something_new"), "provider_error");
  assert.equal(pausedReasonKey(null), "provider_error");
});

check("microsoftRecipientError stores code and message, capped at 500", () => {
  assert.equal(microsoftRecipientError("ErrorInvalidRecipients", "bad"), "ms:ErrorInvalidRecipients|bad");
  assert.equal(microsoftRecipientError(null, "x"), "ms:unknown|x");
  assert.equal(microsoftRecipientError("C", "y".repeat(600)).length, 500);
});

check("recipientFailure translates stored errors and keeps the technical text", () => {
  assert.equal(recipientFailure(null), null);
  assert.equal(recipientFailure(""), null);
  assert.deepEqual(recipientFailure(INTERRUPTED_ERROR), { key: "interrupted", technical: "interrupted" });
  assert.deepEqual(recipientFailure("ms:ErrorInvalidRecipients|At least one recipient is not valid."), {
    key: "invalid_address",
    technical: "ErrorInvalidRecipients: At least one recipient is not valid.",
  });
  assert.deepEqual(recipientFailure("ms:ErrorMessageSizeExceeded|too big"), {
    key: "message_too_large",
    technical: "ErrorMessageSizeExceeded: too big",
  });
  assert.deepEqual(recipientFailure("ms:Weird|x"), { key: "generic", technical: "Weird: x" });
  assert.equal(recipientFailure("Invalid `to` field. The email address needs to follow...")?.key, "invalid_address");
  assert.deepEqual(recipientFailure("Resend 500"), { key: "generic", technical: "Resend 500" });
});

check("pausedMessageKey / listPausedMessageKey pick the provider's wording", () => {
  assert.equal(pausedMessageKey("PLATFORM", "quota"), "paused.quota");
  assert.equal(pausedMessageKey("MICROSOFT", "provider_error"), "paused.provider_error_microsoft");
  assert.equal(pausedMessageKey("MICROSOFT", "daily_limit"), "paused.daily_limit");
  for (const r of ["daily_limit", "reconnect", "no_sender_account", "account_blocked", "provider_error"] as const) {
    assert.equal(pausedMessageKey("GOOGLE", r), `paused.google_${r}`);
  }
  assert.equal(pausedMessageKey("GOOGLE", "attachment_invalid"), "paused.attachment_invalid");
  assert.equal(listPausedMessageKey("MICROSOFT", "daily_limit"), "listReason.paused.daily_limit");
  assert.equal(listPausedMessageKey("GOOGLE", "daily_limit"), "listReason.paused.google_daily_limit");
  assert.equal(listPausedMessageKey("GOOGLE", "provider_error"), "listReason.paused.provider_error");
});

check("googleRecipientError and recipientFailure for gg: errors", () => {
  assert.equal(googleRecipientError("badRequest", "Invalid To header"), "gg:badRequest|Invalid To header");
  assert.equal(googleRecipientError("x", "y".repeat(600)).length, 500);
  assert.deepEqual(recipientFailure("gg:badRequest|Invalid To header"), { key: "invalid_address", technical: "badRequest: Invalid To header" });
  assert.deepEqual(recipientFailure("gg:backendError|x"), { key: "generic", technical: "backendError: x" });
});

check("listReason picks the red line of the sends list", () => {
  assert.deepEqual(listReason({ status: "PAUSED", pausedReason: "daily_limit", problems: 0, uncertain: 0 }), {
    kind: "paused",
    reason: "daily_limit",
  });
  assert.deepEqual(listReason({ status: "PAUSED", pausedReason: null, problems: 3, uncertain: 0 }), {
    kind: "paused",
    reason: "provider_error",
  });
  assert.deepEqual(listReason({ status: "DONE", pausedReason: null, problems: 12, uncertain: 1 }), {
    kind: "problems",
    failed: 12,
    uncertain: 1,
  });
  assert.equal(listReason({ status: "DONE", pausedReason: null, problems: 0, uncertain: 0 }), null);
  assert.equal(listReason({ status: "DRAFT", pausedReason: null, problems: 0, uncertain: 0 }), null);
});

// --- sends list per channel ----------------------------------------------------
check("listChannelFromParam: no ?canal= means asking, unless Microsoft isn't set up", () => {
  const ms = { microsoft: true, google: false, smtp: false };
  const none = { microsoft: false, google: false, smtp: false };
  assert.equal(listChannelFromParam(undefined, ms), null);
  assert.equal(listChannelFromParam("", ms), null);
  assert.equal(listChannelFromParam("outra", ms), null);
  assert.equal(listChannelFromParam("plataforma", ms), "plataforma");
  assert.equal(listChannelFromParam("microsoft", ms), "microsoft");
  assert.equal(listChannelFromParam(["microsoft", "plataforma"], ms), "microsoft");
  assert.equal(listChannelFromParam(undefined, none), "plataforma");
  assert.equal(listChannelFromParam("microsoft", none), "plataforma");
});

check("listChannelFromParam with three channels", () => {
  const both = { microsoft: true, google: true, smtp: false };
  assert.equal(listChannelFromParam("google", both), "google");
  assert.equal(listChannelFromParam("google", { microsoft: true, google: false, smtp: false }), null);
  assert.equal(listChannelFromParam("microsoft", { microsoft: false, google: true, smtp: false }), null);
  assert.equal(listChannelFromParam(undefined, { microsoft: false, google: false, smtp: false }), "plataforma");
  assert.equal(listChannelFromParam("google", { microsoft: false, google: false, smtp: false }), "plataforma");
  assert.equal(listChannelOf("GOOGLE"), "google");
  assert.equal(broadcastChannelOf("google"), "GOOGLE");
});

check("list channel links and the broadcast channel they map to", () => {
  assert.equal(emailListHref(null), "/app/email");
  assert.equal(emailListHref("plataforma"), "/app/email?canal=plataforma");
  assert.equal(emailListHref("microsoft"), "/app/email?canal=microsoft");
  assert.equal(emailListHref("google"), "/app/email?canal=google");
  assert.equal(listChannelOf("PLATFORM"), "plataforma");
  assert.equal(listChannelOf("MICROSOFT"), "microsoft");
  assert.equal(broadcastChannelOf("plataforma"), "PLATFORM");
  assert.equal(broadcastChannelOf("microsoft"), "MICROSOFT");
});

check("SMTP failure reasons, paused texts and list channel", () => {
  assert.equal(smtpRecipientError("rcpt-550", "5.1.1 User unknown"), "smtp:rcpt-550|5.1.1 User unknown");
  assert.equal(smtpRecipientError("rcpt-550", "x".repeat(600)).length, 500);
  assert.deepEqual(recipientFailure("smtp:rcpt-550|5.1.1 User unknown"), { key: "invalid_address", technical: "rcpt-550: 5.1.1 User unknown" });
  assert.equal(recipientFailure("smtp:message-552|5.3.4 Message size exceeds fixed limit")?.key, "message_too_large");
  assert.equal(recipientFailure("smtp:rcpt-552|5.2.2 Mailbox full")?.key, "generic");
  assert.equal(recipientFailure("smtp:message-554|spam")?.key, "generic");
  // a bare 552 at the final answer is a size, unless it carries an address or mailbox code (5.2.3 is a length again)
  assert.equal(recipientFailure("smtp:message-552|5.2.2 Mailbox full")?.key, "generic");
  assert.equal(recipientFailure("smtp:message-552|Message rejected")?.key, "message_too_large");
  assert.equal(recipientFailure("smtp:message-552|5.2.3 Message length exceeds administrative limit")?.key, "message_too_large");
  assert.equal(pausedMessageKey("SMTP", "daily_limit"), "paused.smtp_daily_limit");
  assert.equal(pausedMessageKey("SMTP", "provider_error"), "paused.smtp_provider_error");
  assert.equal(pausedMessageKey("SMTP", "quota"), "paused.quota");
  assert.equal(listPausedMessageKey("SMTP", "reconnect"), "listReason.paused.smtp_reconnect");
  assert.equal(listPausedMessageKey("SMTP", "provider_error"), "listReason.paused.provider_error");
  assert.equal(failureMessageKey("SMTP", "message_too_large"), "failure.smtp_message_too_large");
  assert.equal(failureMessageKey("MICROSOFT", "message_too_large"), "failure.message_too_large");
  assert.equal(failureMessageKey("SMTP", "generic"), "failure.generic");
  assert.equal(listChannelFromParam("smtp", { microsoft: false, google: false, smtp: true }), "smtp");
  assert.equal(listChannelFromParam("smtp", { microsoft: true, google: true, smtp: false }), null);
  assert.equal(listChannelFromParam(undefined, { microsoft: false, google: false, smtp: false }), "plataforma");
  assert.equal(listChannelOf("SMTP"), "smtp");
  assert.equal(broadcastChannelOf("smtp"), "SMTP");
  assert.equal(emailListHref("smtp"), "/app/email?canal=smtp");
  const now = new Date("2026-10-21T12:00:00Z");
  assert.deepEqual(sentLastHourWhere("acc", now), {
    status: { in: ["SENT", "SENDING", "UNCERTAIN"] },
    sentAt: { gte: new Date("2026-10-21T11:00:00Z") },
    broadcast: { senderAccountId: "acc" },
  });
});

check("SMTP stored errors and channel wordings hold for every phase and reason", () => {
  for (const reply of ["550", "551", "553", "501", "510", "511"])
    assert.equal(recipientFailure(`smtp:rcpt-${reply}|x`)?.key, "invalid_address", reply);
  for (const code of ["rcpt-554", "rcpt-552", "rcpt-450", "mail-550", "data-550", "message-550", "transfer", "guard"])
    assert.equal(recipientFailure(`smtp:${code}|x`)?.key, "generic", code);
  assert.deepEqual(recipientFailure("smtp:rcpt-550"), { key: "invalid_address", technical: "rcpt-550" });
  assert.equal(recipientFailure("smtp:rcpt-552|5.3.4 Message size exceeds fixed limit")?.key, "message_too_large");
  assert.equal(smtpRecipientError(null, "x"), "smtp:unknown|x");
  for (const r of ["daily_limit", "reconnect", "no_sender_account", "account_blocked", "provider_error"] as const) {
    assert.equal(pausedMessageKey("SMTP", r), `paused.smtp_${r}`);
    assert.equal(pausedMessageKey("GOOGLE", r), `paused.google_${r}`);
  }
  for (const r of ["daily_limit", "reconnect", "no_sender_account", "account_blocked"] as const)
    assert.equal(listPausedMessageKey("SMTP", r), `listReason.paused.smtp_${r}`);
  for (const r of ["quota", "no_connection", "domain_not_allowed", "from_missing", "attachment_unavailable", "attachment_invalid"] as const) {
    assert.equal(pausedMessageKey("SMTP", r), `paused.${r}`);
    assert.equal(listPausedMessageKey("SMTP", r), `listReason.paused.${r}`);
  }
  assert.equal(pausedMessageKey("PLATFORM", "daily_limit"), "paused.daily_limit");
  for (const key of ["invalid_address", "interrupted", "generic"] as const) assert.equal(failureMessageKey("SMTP", key), `failure.${key}`);
  const smtpOnly = { microsoft: false, google: false, smtp: true };
  assert.equal(listChannelFromParam(undefined, smtpOnly), null);
  assert.equal(listChannelFromParam("microsoft", smtpOnly), null);
  assert.equal(listChannelFromParam(["smtp", "plataforma"], smtpOnly), "smtp");
  assert.equal(listChannelFromParam("smtp", { microsoft: true, google: true, smtp: true }), "smtp");
});

// --- Microsoft inbox ---------------------------------------------------------
check("inbox tab, filter and search come from the URL with safe defaults", () => {
  assert.equal(microsoftTabFromParam("caixa"), "caixa");
  assert.equal(microsoftTabFromParam(undefined), "envios");
  assert.equal(microsoftTabFromParam("x"), "envios");
  assert.equal(inboxFilterFromParam(["nao-lidas"]), "nao-lidas");
  assert.equal(inboxFilterFromParam("respostas"), "respostas");
  assert.equal(inboxFilterFromParam("tudo"), "todas");
  assert.equal(inboxSearchFromParam("  preço  "), "preço");
  assert.equal(inboxSearchFromParam("x".repeat(300)).length, 100);
});

check("cleanPreview drops the invisible padding newsletters put in previews", () => {
  assert.equal(cleanPreview("Existem centenas deles \u034f \u200c \u034f \u200c\u00ad \ufeff"), "Existem centenas deles");
  assert.equal(cleanPreview("  linha 1\r\n\u00a0linha 2 "), "linha 1 linha 2");
  assert.equal(cleanPreview("a\u200bb"), "ab");
});

check("inboxHref keeps only what differs from the defaults", () => {
  assert.equal(inboxHref(), "/app/email?canal=microsoft&aba=caixa");
  assert.equal(inboxHref({ filtro: "todas", q: "", msg: "" }), "/app/email?canal=microsoft&aba=caixa");
  assert.equal(
    inboxHref({ filtro: "nao-lidas", q: "tabela de preço", msg: "AAMk=" }),
    "/app/email?canal=microsoft&aba=caixa&filtro=nao-lidas&q=tabela+de+pre%C3%A7o&msg=AAMk%3D",
  );
});

check("isGraphId accepts Graph ids and refuses anything that could bend a URL", () => {
  assert.ok(isGraphId("AAMkAGI2TG93AAA="));
  assert.ok(isGraphId("AQMkADAwATM0MDAAMS1i_ZDA-AAA/+"));
  assert.ok(!isGraphId(""));
  assert.ok(!isGraphId("../me/messages"));
  assert.ok(!isGraphId("abc?$select=body"));
  assert.ok(!isGraphId("a b"));
  assert.ok(!isGraphId(undefined));
  assert.ok(!isGraphId("x".repeat(513)));
});

check("graphSearchValue quotes the text and drops quotes and backslashes", () => {
  assert.equal(graphSearchValue("  tabela  de preços "), '"tabela de preços"');
  assert.equal(graphSearchValue('a"b\\c'), '"a b c"');
  assert.equal(graphSearchValue('  "" '), null);
});

check("normalizeSubject strips reply, forward and auto-reply markers", () => {
  assert.equal(normalizeSubject("RE: RES: Tabela de Preços"), "tabela de preços");
  assert.equal(normalizeSubject("Fwd:  Re[2]: Convite"), "convite");
  assert.equal(normalizeSubject("Resposta automática: Tabela"), "tabela");
  assert.equal(normalizeSubject("Automatic reply: Tabela"), "tabela");
  assert.equal(normalizeSubject("Recibo de março"), "recibo de março");
  assert.equal(normalizeSubject("RE: [EXTERNAL] Proposta"), "proposta");
  assert.equal(normalizeSubject("*EXTERNAL* RE: Proposta"), "proposta");
  assert.equal(normalizeSubject("[EXT] Re: Tabela"), "tabela");
});

check("subjectAnswers matches literal pieces around {{nome}}/{{empresa}} in order", () => {
  assert.ok(subjectAnswers("Re: Tabela de preços — outubro", "Tabela de preços — outubro"));
  assert.ok(subjectAnswers("RES: Oi Ana, novidades da Loja X", "Oi {{nome}}, novidades da {{empresa}}"));
  assert.ok(!subjectAnswers("Re: novidades da Loja X, oi Ana", "Oi {{nome}}, novidades da {{empresa}}"));
  assert.ok(!subjectAnswers("Re: Outro assunto", "Tabela de preços"));
  assert.ok(!subjectAnswers("Re: Ana", "{{nome}}"), "a subject made only of variables matches nothing");
});

check("subjectAnswers anchors the first and last pieces unless a variable sits there", () => {
  assert.ok(!subjectAnswers("Nova proposta de parceria", "Proposta"), "no variables: subjects must be equal");
  assert.ok(!subjectAnswers("Re: Proposta revisada", "Proposta"));
  assert.ok(subjectAnswers("RES: Proposta", "Proposta"));
  assert.ok(subjectAnswers("Resposta automática: Proposta", "Proposta"));
  assert.ok(subjectAnswers("Re: Ana, sua proposta", "{{nome}}, sua proposta"));
  assert.ok(subjectAnswers("Re: joi oi", "{{nome}} oi"), "the last piece is found at the end, not at its first copy");
  assert.ok(!subjectAnswers("Re: Ana, sua proposta nova", "{{nome}}, sua proposta"));
  assert.ok(subjectAnswers("Re: Proposta para Loja X", "Proposta para {{empresa}}"));
  assert.ok(!subjectAnswers("Re: Nova proposta para Loja X", "Proposta para {{empresa}}"));
  assert.ok(!subjectAnswers("Re: Oi Ana, novidades da Loja X e mais", "Oi {{nome}}, novidades da Loja X"));
});

check("matchReplyToSend picks the latest earlier send to that sender with a matching subject", () => {
  const sends = [
    { email: "ana@x.com", broadcastId: "b1", subject: "Tabela de preços", sentAt: new Date("2026-10-01T10:00:00Z") },
    { email: "ana@x.com", broadcastId: "b2", subject: "Tabela de preços", sentAt: new Date("2026-10-12T10:00:00Z") },
    { email: "ana@x.com", broadcastId: "b3", subject: "Tabela de preços", sentAt: new Date("2026-10-20T10:00:00Z") },
    { email: "bia@x.com", broadcastId: "b4", subject: "Convite", sentAt: new Date("2026-10-08T10:00:00Z") },
  ];
  const at = new Date("2026-10-15T12:00:00Z");
  assert.equal(matchReplyToSend({ fromEmail: "Ana@X.com", subject: "RE: Tabela de preços", receivedAt: at }, sends)?.broadcastId, "b2");
  assert.equal(matchReplyToSend({ fromEmail: "ana@x.com", subject: "Outro", receivedAt: at }, sends), null);
  assert.equal(matchReplyToSend({ fromEmail: "caio@x.com", subject: "Re: Convite", receivedAt: at }, sends), null);
  assert.equal(matchReplyToSend({ fromEmail: null, subject: "Re: Convite", receivedAt: at }, sends), null);
});

check("summaryFromGraph and attachmentsFromGraph read Graph defensively", () => {
  const m = summaryFromGraph({
    id: "AAMk1",
    subject: " Oi ",
    from: { emailAddress: { name: "Ana", address: "Ana@X.com" } },
    receivedDateTime: "2026-10-20T10:00:00Z",
    isRead: false,
    hasAttachments: true,
    bodyPreview: "linha 1\r\n linha 2",
  });
  assert.deepEqual(m, {
    id: "AAMk1",
    subject: "Oi",
    from: { name: "Ana", email: "ana@x.com" },
    receivedAt: "2026-10-20T10:00:00Z",
    isRead: false,
    hasAttachments: true,
    preview: "linha 1 linha 2",
  });
  assert.equal(summaryFromGraph({ id: "../x" }), null);
  assert.equal(summaryFromGraph(null), null);
  const raw = [
    { "@odata.type": "#microsoft.graph.fileAttachment", id: "A1", name: "nota.pdf", contentType: "application/pdf", size: 10, isInline: false },
    { "@odata.type": "#microsoft.graph.fileAttachment", id: "A2", name: "logo.png", isInline: true },
    { "@odata.type": "#microsoft.graph.itemAttachment", id: "A3", name: "Convite", size: 5 },
    { id: "../x", name: "bad id" },
  ];
  const ids = (atts: { id: string; downloadable: boolean }[]) => atts.map((a) => [a.id, a.downloadable]);
  assert.deepEqual(ids(attachmentsFromGraph(raw)), [
    ["A1", true],
    ["A2", true],
    ["A3", false],
  ], "an inline part not shown in the body stays listed");
  assert.deepEqual(ids(attachmentsFromGraph(raw, new Set(["A2"]))), [
    ["A1", true],
    ["A3", false],
  ], "an inline image shown in the body is hidden");
  assert.deepEqual(ids(attachmentsFromGraph(raw, new Set(["A1", "A3"]))).map(([id]) => id), ["A1", "A2", "A3"], "regular attachments are always listed");
  assert.deepEqual(attachmentsFromGraph(null), []);
});

check("replyHtmlFromText escapes the typed text and keeps its line breaks", () => {
  assert.equal(replyHtmlFromText(" Oi <b>Ana</b>\n\nAbraço "), "<div>Oi &lt;b&gt;Ana&lt;/b&gt;<br><br>Abraço</div>");
});

check("replaceCidImages swaps known content ids only", () => {
  const html = '<img src="cid:logo@01"><img src="CID:other">';
  assert.equal(
    replaceCidImages(html, { "<logo@01>": "data:image/png;base64,AA" }),
    '<img src="data:image/png;base64,AA"><img src="CID:other">',
  );
  assert.equal(replaceCidImages(html, {}), html);
});

check("inboxBodyDocument locks the body down and escapes plain text", () => {
  const doc = inboxBodyDocument({ contentType: "html", content: "<p>Oi</p>" });
  assert.match(doc, /Content-Security-Policy" content="default-src 'none'/);
  assert.match(doc, /<base target="_blank">/);
  assert.ok(doc.indexOf("Content-Security-Policy") < doc.indexOf("<p>Oi</p>"), "the policy comes before the sender's HTML");
  const text = inboxBodyDocument({ contentType: "text", content: "<script>x</script>" });
  assert.ok(!text.includes("<script>"));
  assert.ok(text.includes("&lt;script&gt;"));
  const linked = inboxBodyDocument({ contentType: "html", content: '<a rel="opener" href="https://x.com">x</a>' });
  assert.ok(linked.includes('<a rel=noopener  rel="opener" href="https://x.com">x</a>'), "HTML links can't get the opener");
  const plainLink = inboxBodyDocument({ contentType: "text", content: "<a href=x>" });
  assert.ok(!plainLink.includes("noopener"), "plain text is escaped, not rewritten");
});

check("neutralizeOpeners puts rel=noopener first on <a> and <area> only", () => {
  assert.equal(neutralizeOpeners('<a rel="opener" href="x">'), '<a rel=noopener  rel="opener" href="x">');
  assert.equal(neutralizeOpeners("<A HREF=x>y</A>"), "<A rel=noopener  HREF=x>y</A>");
  assert.equal(neutralizeOpeners("<area shape=rect>"), "<area rel=noopener  shape=rect>");
  assert.equal(neutralizeOpeners("<a>"), "<a rel=noopener >");
  assert.equal(neutralizeOpeners('<a\nhref="x">'), '<a rel=noopener \nhref="x">');
  // The trailing space ends the unquoted value: a "/" can't glue the sender's rel onto ours.
  assert.equal(neutralizeOpeners('<a/rel="opener">'), '<a rel=noopener /rel="opener">');
  // No quotes are added, so an "<a" inside a quoted attribute can't break out of it.
  assert.equal(neutralizeOpeners('<p data-x="<a href=y>">z</p>'), '<p data-x="<a rel=noopener  href=y>">z</p>');
  const untouched = "<abbr>x</abbr><address>y</address><article>z</article><b>a</b>";
  assert.equal(neutralizeOpeners(untouched), untouched);
});

check("attachmentDisposition always downloads and encodes the name", () => {
  assert.equal(attachmentDisposition("nota.pdf"), "attachment; filename=\"nota.pdf\"; filename*=UTF-8''nota.pdf");
  assert.equal(
    attachmentDisposition('relatório "final".pdf'),
    "attachment; filename=\"relat_rio _final_.pdf\"; filename*=UTF-8''relat%C3%B3rio%20%22final%22.pdf",
  );
  assert.equal(attachmentDisposition("a\r\nb"), "attachment; filename=\"a  b\"; filename*=UTF-8''a%20%20b");
  assert.equal(attachmentDisposition("   "), "attachment; filename=\"anexo\"; filename*=UTF-8''anexo");
});

check("attachmentDisposition survives lone surrogates and escapes ' ( ) * (RFC 5987)", () => {
  assert.doesNotThrow(() => attachmentDisposition("a\uD800b.pdf"));
  assert.ok(attachmentDisposition("a\uD800b.pdf").endsWith("filename*=UTF-8''a%EF%BF%BDb.pdf"));
  assert.ok(attachmentDisposition("a\uDC00.pdf").endsWith("filename*=UTF-8''a%EF%BF%BD.pdf"));
  assert.ok(attachmentDisposition("😀.pdf").endsWith("filename*=UTF-8''%F0%9F%98%80.pdf"), "a real pair is kept");
  assert.equal(
    attachmentDisposition("it's (1)*.pdf"),
    "attachment; filename=\"it's (1)*.pdf\"; filename*=UTF-8''it%27s%20%281%29%2A.pdf",
  );
});

async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main() {
  await checkAsync("xlsxCellTexts reads every sheet, link targets and rich text of a real .xlsx", async () => {
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet("Evento SP");
    a.addRow(["Nome", "E-mail", "Idade"]);
    a.addRow(["Ana", "ana@x.com", 31]);
    a.addRow(["Bia", { text: "Escreva para a Bia", hyperlink: "mailto:bia@x.com" }]);
    a.addRow(["Caio", { text: "caio@x.com", hyperlink: "mailto:caio@x.com" }]);
    a.addRow(["Dani", { richText: [{ text: "dani@" }, { text: "x.com", font: { bold: true } }] }]);
    const b = wb.addWorksheet("Evento RJ");
    b.addRow(["Edu", "edu@x.com"]);
    const data = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

    const r = extractEmails(await xlsxCellTexts(ExcelJS, data));
    assert.deepEqual(r.emails, ["ana@x.com", "bia@x.com", "caio@x.com", "dani@x.com", "edu@x.com"]);
    assert.equal(r.duplicates, 0);
    assert.equal(r.invalid, 0);
  });

  await checkAsync("xlsxCellTexts rejects a file that isn't an .xlsx", async () => {
    await assert.rejects(xlsxCellTexts(ExcelJS, new TextEncoder().encode("ana@x.com").buffer as ArrayBuffer));
  });

  await checkAsync("buildMime encodes accents and keeps the unsubscribe headers and both parts", async () => {
    const acc = String.fromCharCode(0xe7, 0xe3); // the two accented letters of "çã"
    const mime = (
      await buildMime({
        from: { name: `Loja Solu${acc}o`, address: "contato@loja.com" },
        to: "ana@x.com",
        replyTo: "resp@loja.com",
        subject: `Promo${acc}o de outubro`,
        html: "<p>Oi</p>",
        text: "Oi",
        headers: {
          "List-Unsubscribe": "<https://metodotia.com/api/email/unsubscribe/r1/sig>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        attachments: [{ filename: `cat${acc}logo.pdf`, contentType: "application/pdf", data: Buffer.from("PDFDATA") }],
      })
    ).toString("utf8");
    assert.match(mime, /^Subject: =\?UTF-8\?/m);
    assert.match(mime, /^From: =\?UTF-8\?.+<contato@loja\.com>/m);
    assert.match(mime, /^To: ana@x\.com/m);
    assert.match(mime, /^Reply-To: resp@loja\.com/m);
    assert.match(mime, /^List-Unsubscribe: <https:\/\/metodotia\.com\/api\/email\/unsubscribe\/r1\/sig>/m);
    assert.match(mime, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click/m);
    assert.match(mime, /multipart\/alternative/);
    assert.match(mime, /Content-Type: text\/html/);
    assert.match(mime, /Content-Type: text\/plain/);
    assert.match(mime, /Content-Disposition: attachment/);
    assert.ok(mime.includes(Buffer.from("PDFDATA").toString("base64")));
    assert.ok(!mime.includes(`cat${acc}logo.pdf`), "a non-ASCII file name is encoded");
  });

  await checkAsync("buildMime without attachments or reply-to has no mixed part", async () => {
    const mime = (
      await buildMime({
        from: { name: null, address: "a@b.com" },
        to: "c@d.com",
        replyTo: null,
        subject: "Oi",
        html: "<p>Oi</p>",
        text: "Oi",
        headers: {},
        attachments: [],
      })
    ).toString("utf8");
    assert.match(mime, /^From: a@b\.com/m);
    assert.ok(!/multipart\/mixed/.test(mime));
    assert.ok(!/^Reply-To:/m.test(mime));
  });

  console.log(`\n✅ email-broadcast: ${passed} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
