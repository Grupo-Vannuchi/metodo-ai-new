/**
 * Self-check for the pure helpers of the mass e-mail module (no DB, no
 * network, no env). Run with `npm run check:email`; exits non-zero on the
 * first failure.
 *
 * Only modules WITHOUT `import "server-only"` can be imported here: outside
 * Next's bundler there is no `server-only` package to resolve.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ExcelJS from "exceljs";
import PostalMime, { type Attachment, type Email } from "postal-mime";
import { isValidEmail, normalizeEmail, parseEmailList } from "../src/lib/email-broadcast/normalize";
import { mergeCandidates, spreadsheetCandidates, type Candidate } from "../src/lib/email-broadcast/audience-core";
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
  MAX_PERSON_TEXT,
  audienceEmailCount,
  csvRows,
  decodeCsv,
  extractEmails,
  fitImport,
  readCsv,
  readSheets,
  spreadsheetKind,
  withoutEmail,
  xlsxSheets,
  type SheetCell,
} from "../src/lib/email-broadcast/spreadsheet";
import { EMPTY_AUDIENCE, audienceSelectionSchema, broadcastDraftSchema } from "../src/lib/validations/email-broadcast";
import {
  INTERRUPTED_ERROR,
  PAUSED_REASONS,
  failureMessageKey,
  googleRecipientError,
  listPausedMessageKey,
  listReason,
  microsoftRecipientError,
  pausedMessageKey,
  pausedReasonKey,
  recipientFailure,
  smtpRecipientError,
  type MailboxChannel,
  type RecipientFailureKey,
} from "../src/lib/email-broadcast/failure-reason";
import ptMessages from "../src/messages/pt.json";
import enMessages from "../src/messages/en.json";
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
  type MailboxSendOutcome,
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
  withSavedSmtpPassword,
} from "../src/lib/email-broadcast/smtp/core";
import { isBlockedSmtpAddress, pickSmtpAddress } from "../src/lib/email-broadcast/smtp/address";
import { redactAndCut, redactSmtpSecrets } from "../src/lib/email-broadcast/smtp/redact";
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
  mailboxTabFromParam,
  neutralizeOpeners,
  normalizeSubject,
  replaceCidImages,
  replyHtmlFromText,
  subjectAnswers,
  summaryFromGraph,
  type InboxMessageSummary,
} from "../src/lib/email-broadcast/microsoft/inbox-core";
import {
  IMAP_PORTS,
  REPLY_REFERENCES_MAX,
  REPLY_SUBJECT_MAX_CHARS,
  THREAD_HEADERS_MAX_CHARS,
  defaultImapSecurity,
  imapConnectError,
  imapMessageRef,
  isAttachmentIndex,
  parseImapMessageRef,
  pickSentFolder,
  replyAddress,
  replyHeaders,
  replyHeadersForSend,
  replyOutcome,
  suggestImapHost,
  summaryFromImap,
  threadIdsFromHeaders,
  type ImapConnectError,
  type ImapSettings,
} from "../src/lib/email-broadcast/imap/core";
import {
  detailFromParsed,
  hasAttachmentsInStructure,
  listedAttachments,
  type ImapBodyNode,
} from "../src/lib/email-broadcast/imap/parse";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/**
 * Milliseconds `fn` takes. For the checks that a pattern fed a sender's text
 * can't be made to backtrack quadratically: at the sizes they use, a quadratic
 * pattern takes about a minute and a linear one a few milliseconds, so a
 * generous limit is not flaky.
 */
function millis(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
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

check("spreadsheetCandidates gives each address its row's name and company (blank → none)", () => {
  assert.deepEqual(
    spreadsheetCandidates([
      { emails: ["a@x.com", "b@x.com"], people: [{ name: "Ana Lima", company: "" }, { name: "", company: "Y" }] },
      { emails: ["c@x.com"] },
    ]),
    [
      { email: "a@x.com", source: "spreadsheet", name: "Ana Lima", companyName: null },
      { email: "b@x.com", source: "spreadsheet", name: null, companyName: "Y" },
      { email: "c@x.com", source: "spreadsheet", name: null, companyName: null },
    ],
  );
});

check("mergeCandidates lets a contact's name win over a spreadsheet row, which fills the contact's blanks", () => {
  const { recipients } = mergeCandidates(
    [
      { email: "ana@x.com", source: "spreadsheet", name: "Ana Planilha", companyName: "X da Planilha" },
      { email: "ana@x.com", source: "contact", name: "Ana CRM", companyName: null, contactId: "c1" },
      { email: "bia@x.com", source: "spreadsheet", name: "Bia Souza", companyName: "Y" },
    ],
    new Set(),
  );
  assert.deepEqual(
    recipients.map((r) => [r.email, r.name, r.companyName]),
    [
      ["ana@x.com", "Ana CRM", "X da Planilha"],
      ["bia@x.com", "Bia Souza", "Y"],
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

/** A sheet of plain cells (no links), as a .csv or a simple .xlsx gives it. */
const sheet = (rows: string[][]): SheetCell[][] => rows.map((row) => row.map((text) => ({ text, link: null })));

check("readSheets takes {{nome}} (nome + sobrenome) and {{empresa}} from the header row", () => {
  const r = readSheets([
    sheet([
      ["email", "tipo_email", "nome", "sobrenome", "cargo", "empresa", "telefone"],
      ["eallan@suzano.com.br", "corporativo", "Edson", "Allan Franco", "Supervisor", "Suzano — unidade Limeira/SP", "19 99154-3192"],
      ["Wesley.RodrigoSilva@Hotmail.com", "pessoal", "Wesley", "Rodrigo", "Encarregado", "Toyota do Brasil", ""],
      ["cxmbr1976@gmail.com", "pessoal", "Xiaomeng", "", "", "", ""],
    ]),
  ]);
  assert.deepEqual(r.emails, ["eallan@suzano.com.br", "wesley.rodrigosilva@hotmail.com", "cxmbr1976@gmail.com"]);
  assert.deepEqual(r.people, [
    { name: "Edson Allan Franco", company: "Suzano — unidade Limeira/SP" },
    { name: "Wesley Rodrigo", company: "Toyota do Brasil" },
    { name: "Xiaomeng", company: "" },
  ]);
  assert.equal(r.invalid, 0);
  assert.equal(r.duplicates, 0);
});

check("readSheets finds the columns without case, accents or separators, and only those four", () => {
  const r = readSheets([
    sheet([
      [" ", ""],
      ["Tipo_Email", "EMPRESA ", "Sobre-nome", "E-mail", "Nóme", "e_mail"],
      ["corporativo", "ACME", "Lima", "joao@acme.com", "João", "outro@acme.com"],
    ]),
  ]);
  // The first non-empty row is the header; the first "email" column wins.
  assert.deepEqual(r.emails, ["joao@acme.com"]);
  assert.deepEqual(r.people, [{ name: "João Lima", company: "ACME" }]);
});

check("readSheets without the email header reads every cell, as before", () => {
  const r = readSheets([sheet([["Nome", "Contato"], ["Ana", "ana@x.com"], ["Bia", "bia@x.com; caio@x.com"]])]);
  assert.deepEqual(r.emails, ["ana@x.com", "bia@x.com", "caio@x.com"]);
  assert.equal(r.people, null);
});

check("readSheets keeps the first row of a repeated address and counts the rest", () => {
  const r = readSheets([
    sheet([
      ["email", "nome", "empresa"],
      ["ana@x.com", "Ana", "X"],
      ["", "Sem e-mail", "Y"],
      ["ANA@x.com", "Outra Ana", "Z"],
      ["maria@@exemplo", "Maria", "W"],
      ["bia@x.com; caio@x.com", "Família Souza", "V"],
    ]),
  ]);
  assert.deepEqual(r.emails, ["ana@x.com", "bia@x.com", "caio@x.com"]);
  assert.deepEqual(r.people, [
    { name: "Ana", company: "X" },
    { name: "Família Souza", company: "V" },
    { name: "Família Souza", company: "V" },
  ]);
  assert.equal(r.duplicates, 1);
  assert.equal(r.invalid, 1);
});

check("readSheets uses a link's target when the e-mail cell's text isn't an address", () => {
  const r = readSheets([
    [
      [{ text: "email", link: null }, { text: "nome", link: null }],
      [{ text: "Escreva para a Bia", link: "mailto:bia@x.com" }, { text: "Bia", link: null }],
      [{ text: "caio@x.com", link: "mailto:caio@outro.com" }, { text: "Caio", link: null }],
    ],
  ]);
  assert.deepEqual(r.emails, ["bia@x.com", "caio@x.com"]);
  assert.deepEqual(r.people, [
    { name: "Bia", company: "" },
    { name: "Caio", company: "" },
  ]);
});

check("readSheets reads columns by position, and mixes sheets with and without the header", () => {
  const sparse: SheetCell[] = [];
  sparse[0] = { text: "edu@x.com", link: null };
  sparse[3] = { text: "Edu ACME", link: null };
  const r = readSheets([[sheet([["email", "nome", "sobrenome", "empresa"]])[0], sparse], sheet([["avulso@y.com"]]), []]);
  assert.deepEqual(r.emails, ["edu@x.com", "avulso@y.com"]);
  assert.deepEqual(r.people, [
    { name: "", company: "Edu ACME" },
    { name: "", company: "" },
  ]);
});

check("readSheets tidies names and companies and caps them at MAX_PERSON_TEXT", () => {
  const long = "x".repeat(MAX_PERSON_TEXT + 20);
  const r = readSheets([sheet([["email", "nome", "sobrenome", "empresa"], ["a@x.com", "  Ana \n Maria ", " Souza  ", long]])]);
  assert.deepEqual(r.people, [{ name: "Ana Maria Souza", company: "x".repeat(MAX_PERSON_TEXT) }]);
});

check("csvRows reads quoted fields, the header line's separator and line breaks", () => {
  assert.deepEqual(csvRows('﻿"email","nome"\r\n"a@x.com","Silva, Ana"\r\n'), [
    ["email", "nome"],
    ["a@x.com", "Silva, Ana"],
  ]);
  assert.deepEqual(csvRows('email;nome;empresa\nb@x.com;"Bia ""B"" Lima";"Rua 1\nSala 2"\n'), [
    ["email", "nome", "empresa"],
    ["b@x.com", 'Bia "B" Lima', "Rua 1\nSala 2"],
  ]);
  assert.deepEqual(csvRows("email\tnome\nc@x.com\tCaio"), [
    ["email", "nome"],
    ["c@x.com", "Caio"],
  ]);
  assert.deepEqual(csvRows('"e,mail";nome\nd@x.com;Dani'), [
    ["e,mail", "nome"],
    ["d@x.com", "Dani"],
  ]);
  assert.deepEqual(csvRows(""), []);
});

check("readCsv maps the header row and otherwise reads every address, as before", () => {
  const mapped = readCsv(
    '"email","tipo_email","nome","sobrenome","empresa"\n"eallan@suzano.com.br","corporativo","Edson","Allan Franco","Suzano"\n',
  );
  assert.deepEqual(mapped.emails, ["eallan@suzano.com.br"]);
  assert.deepEqual(mapped.people, [{ name: "Edson Allan Franco", company: "Suzano" }]);
  const excelBr = readCsv("E-mail;Nome;Sobrenome;Empresa\r\nana@x.com;Ana;Lima;ACME\r\n");
  assert.deepEqual(excelBr.people, [{ name: "Ana Lima", company: "ACME" }]);
  const legacy = readCsv('nome,contato\n"Silva, Ana","ana@x.com"\nBia;mailto:bia@y.com\r\n');
  assert.deepEqual(legacy.emails, ["ana@x.com", "bia@y.com"]);
  assert.equal(legacy.people, null);
});

check("decodeCsv reads UTF-8 and falls back to Excel's Windows-1252", () => {
  const joao = `Jo${String.fromCharCode(0xe3)}o`; // "João"
  assert.equal(decodeCsv(new TextEncoder().encode(`nome\n${joao}`)), `nome\n${joao}`);
  // Windows-1252 bytes: "ã" is the single byte 0xE3, invalid as UTF-8.
  assert.equal(decodeCsv(new Uint8Array([0x6e, 0x6f, 0x6d, 0x65, 0x0a, 0x4a, 0x6f, 0xe3, 0x6f])), `nome\n${joao}`);
  const ansi = new Uint8Array([...new TextEncoder().encode("email;nome\na@x.com;Jo"), 0xe3, 0x6f]);
  assert.deepEqual(readCsv(decodeCsv(ansi)).people, [{ name: joao, company: "" }]);
});

check("withoutEmail drops an address together with its name and company", () => {
  const imp = {
    fileName: "a.xlsx",
    emails: ["a@x.com", "b@x.com"],
    people: [
      { name: "Ana", company: "X" },
      { name: "Bia", company: "Y" },
    ],
  };
  assert.deepEqual(withoutEmail(imp, "a@x.com"), {
    fileName: "a.xlsx",
    emails: ["b@x.com"],
    people: [{ name: "Bia", company: "Y" }],
  });
  assert.deepEqual(withoutEmail({ fileName: "b.csv", emails: ["a@x.com"] }, "a@x.com"), { fileName: "b.csv", emails: [] });
  assert.equal(withoutEmail(imp, "z@x.com"), imp);
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

check("audience schema keeps an import's people and refuses a list out of step with its addresses", () => {
  const imp = {
    fileName: "a.xlsx",
    emails: ["a@x.com", "b@x.com"],
    people: [
      { name: "Ana", company: "X" },
      { name: "", company: "" },
    ],
  };
  assert.deepEqual(audienceSelectionSchema.parse({ imports: [imp] }).imports, [imp]);
  assert.ok(!audienceSelectionSchema.safeParse({ imports: [{ ...imp, people: imp.people.slice(1) }] }).success);
  const long = { ...imp, people: [{ name: "x".repeat(MAX_PERSON_TEXT + 1), company: "" }, imp.people[1]] };
  assert.ok(!audienceSelectionSchema.safeParse({ imports: [long] }).success);
  const plain = audienceSelectionSchema.parse({ imports: [{ fileName: "b.csv", emails: ["c@x.com"] }] });
  assert.equal(plain.imports[0].people, undefined);
});

check("broadcastDraftSchema saves a draft for every channel, SMTP included", () => {
  const draft = { subject: "s", html: "<p>x</p>", fromName: "", fromEmail: "", replyTo: "", audience: EMPTY_AUDIENCE };
  for (const channel of ["PLATFORM", "MICROSOFT", "GOOGLE", "SMTP"] as const) {
    const parsed = broadcastDraftSchema.safeParse({ ...draft, channel });
    assert.ok(parsed.success && parsed.data.channel === channel, channel);
  }
  assert.equal(broadcastDraftSchema.parse(draft).channel, "PLATFORM");
  assert.ok(!broadcastDraftSchema.safeParse({ ...draft, channel: "POP" }).success);
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
  // 421 is the server closing the channel: never one recipient's, at any command (retried, then a pause)
  assert.equal(a(421, "rcpt-421", "4.3.2 Service not available, closing transmission channel", 0), "retry");
  assert.equal(a(421, "rcpt-421", "4.3.2 Service not available, closing transmission channel", 5), "pause");
  assert.equal(a(421, "rcpt-421", "Too many connections from your IP", 0), "daily_limit"); // not "Over quota"-like
  assert.equal(a(421, "data-421", "Try again later", 5), "pause");
  assert.equal(a(421, "message-421", "4.2.2 Mailbox full, closing connection", 5), "pause"); // even a mailbox code
  for (const phase of ["mail", "rcpt", "data", "message"])
    for (const attempt of [0, 4, 5, 9]) assert.notEqual(a(421, `${phase}-421`, "Over quota", attempt), "recipient", `${phase} ${attempt}`);
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

check("canKeepSmtpPassword also holds the inbox's server, port and security (spec 2026-10-23)", () => {
  const smtp = { host: "smtpi.kinghost.net", port: 587, security: "starttls" as const, username: "a@b.com" };
  const imap: ImapSettings = { host: "imap.kinghost.net", port: 993, security: "ssl" };
  const saved = (inbox: ImapSettings | null) => ({ ...smtp, status: "ACTIVE" as const, imap: inbox });
  // no inbox before and after, or the very same one: the password only goes where it was typed for
  assert.equal(canKeepSmtpPassword(saved(null), { ...smtp, imap: null }), true);
  assert.equal(canKeepSmtpPassword(saved(imap), { ...smtp, imap: { ...imap } }), true);
  // switching the inbox on, or pointing it at another server, port or security, would send the saved password to a
  // destination it wasn't typed for
  assert.equal(canKeepSmtpPassword(saved(null), { ...smtp, imap }), false);
  assert.equal(canKeepSmtpPassword(saved(imap), { ...smtp, imap: { ...imap, host: "imap.atacante.com" } }), false);
  assert.equal(canKeepSmtpPassword(saved(imap), { ...smtp, imap: { ...imap, port: 143 } }), false);
  assert.equal(canKeepSmtpPassword(saved(imap), { ...smtp, imap: { ...imap, security: "starttls" } }), false);
  // switching it off: nothing is sent to it any more
  assert.equal(canKeepSmtpPassword(saved(imap), { ...smtp, imap: null }), true);
  // an inbox loosens none of the other rules
  assert.equal(canKeepSmtpPassword(null, { ...smtp, imap }), false);
  assert.equal(canKeepSmtpPassword({ ...saved(imap), status: "NEEDS_RECONNECT" }, { ...smtp, imap }), false);
  assert.equal(canKeepSmtpPassword(saved(imap), { ...smtp, host: "smtp.atacante.com", imap }), false);
  assert.equal(canKeepSmtpPassword(saved(imap), { ...smtp, port: 465, imap }), false);
  assert.equal(canKeepSmtpPassword(saved(imap), { ...smtp, security: "ssl", imap }), false);
  assert.equal(canKeepSmtpPassword(saved(imap), { ...smtp, username: "outro@b.com", imap }), false);
  // `imap` left out reads as null on either side (a caller that doesn't know about the inbox)
  const savedBare = { ...smtp, status: "ACTIVE" as const };
  assert.equal(canKeepSmtpPassword(savedBare, smtp), true);
  assert.equal(canKeepSmtpPassword(savedBare, { ...smtp, imap }), false, "an inbox switched on where there was none");
  assert.equal(canKeepSmtpPassword(saved(imap), smtp), true, "an inbox left out is an inbox switched off");
  assert.equal(canKeepSmtpPassword(saved(null), smtp), true);
});

check("withSavedSmtpPassword gives back what the form typed, the inbox included, with the saved password", () => {
  const smtp = { host: "smtpi.kinghost.net", port: 587 as const, security: "starttls" as const, username: "a@b.com" };
  const imap: ImapSettings = { host: "imap.kinghost.net", port: 993, security: "ssl" };
  const saved = { ...smtp, password: "senha-guardada", imap, status: "ACTIVE" as const };
  // an edit that touches nothing of the destination (the name, the limits): the inbox goes on, as it was
  assert.deepEqual(withSavedSmtpPassword(saved, { ...smtp, imap }), { ...smtp, imap, password: "senha-guardada" });
  // the inbox switched off is gone from what is saved, though the saved account had it
  assert.deepEqual(withSavedSmtpPassword(saved, { ...smtp, imap: null }), { ...smtp, imap: null, password: "senha-guardada" });
  assert.deepEqual(withSavedSmtpPassword({ ...saved, imap: null }, { ...smtp, imap: null }), { ...smtp, imap: null, password: "senha-guardada" });
  // an account with no inbox that stays without one
  assert.deepEqual(withSavedSmtpPassword({ ...smtp, password: "senha-guardada", status: "ACTIVE" }, smtp), { ...smtp, password: "senha-guardada" });
  // edits the saved password can't follow: the password has to be typed
  assert.equal(withSavedSmtpPassword({ ...saved, imap: null }, { ...smtp, imap }), null, "inbox switched on");
  assert.equal(withSavedSmtpPassword(saved, { ...smtp, imap: { ...imap, host: "imap.atacante.com" } }), null, "inbox server changed");
  assert.equal(withSavedSmtpPassword(saved, { ...smtp, imap: { ...imap, port: 143 } }), null, "inbox port changed");
  assert.equal(withSavedSmtpPassword(saved, { ...smtp, host: "smtp.atacante.com", imap }), null, "sending server changed");
  assert.equal(withSavedSmtpPassword({ ...saved, status: "NEEDS_RECONNECT" }, { ...smtp, imap }), null, "account needs reconnecting");
  assert.equal(withSavedSmtpPassword(null, { ...smtp, imap }), null, "no account");
});

check("redactSmtpSecrets masks the password and what the login sends of it, and nothing else", () => {
  const s = { username: "contato@cliente.com.br", password: "S3nh@ Secreta!" };
  const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
  const bare = (value: string) => b64(value).replace(/=+$/, "");
  const blob = `\0${s.username}\0${s.password}`; // AUTH PLAIN's "\0user\0password"
  // the sample is chosen so that the user's base64 and the blob's end in "=" padding
  assert.ok(b64(s.username).endsWith("=") && b64(blob).endsWith("="));
  // the password as typed (spaces and all), every time it appears
  assert.equal(
    redactSmtpSecrets(`535 5.7.8 wrong password ${s.password} (again: ${s.password})`, s),
    "535 5.7.8 wrong password *** (again: ***)",
  );
  // what a server may echo back from AUTH: the password, the user and PLAIN's blob in base64, padded or not
  for (const secret of [s.password, s.username, blob]) {
    for (const form of [b64(secret), bare(secret)]) {
      assert.equal(
        redactSmtpSecrets(`535 5.7.8 Authentication failed: ${form} (tried)`, s),
        "535 5.7.8 Authentication failed: *** (tried)",
        form,
      );
    }
  }
  // the padded form goes whole: no "=" is left behind
  assert.equal(redactSmtpSecrets(`AUTH PLAIN ${b64(blob)}`, s), "AUTH PLAIN ***");
  // all of them in one answer
  assert.equal(redactSmtpSecrets(`${b64(s.username)} ${b64(s.password)} ${b64(blob)} ${s.password}`, s), "*** *** *** ***");
  // a password with regex characters is found as written, and only as written
  const odd = { username: "u@x.com", password: "a.b*c(d)[e]+?$^|\\" };
  assert.equal(redactSmtpSecrets(`bad: ${odd.password}`, odd), "bad: ***");
  assert.equal(redactSmtpSecrets("aXb", { username: "u", password: "a.b" }), "aXb");
  // everything else stays: the server's words, the recipient, even the user name in clear
  const other = "550 5.1.1 <ana@exemplo.com.br>: Recipient address rejected: User unknown";
  assert.equal(redactSmtpSecrets(other, s), other);
  assert.equal(redactSmtpSecrets(`535 login ${s.username} refused`, s), `535 login ${s.username} refused`);
  assert.equal(redactSmtpSecrets("", s), "");
  // no password, nothing to hide: the text comes back as it is, the user's base64 included
  const echoed = `${b64("a")} ${bare("a")} a`;
  assert.equal(redactSmtpSecrets(echoed, { username: "a", password: "" }), echoed);
  // an empty user is never searched for: it would match between every character
  assert.equal(redactSmtpSecrets("abc pw", { username: "", password: "pw" }), "abc ***");
});

check("redactAndCut masks a secret that straddles the cut: it redacts first, then cuts", () => {
  const s = { username: "contato@cliente.com.br", password: "S3nh@ Secreta!" };
  const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
  // the password starts 5 characters before the cut at 400
  const text = `${"x".repeat(395)}${s.password} (tried)`;
  // cutting first would leave its first 5 characters behind, where no search finds them any more
  assert.ok(redactSmtpSecrets(text.slice(0, 400), s).includes(s.password.slice(0, 5)));
  assert.equal(redactAndCut(text, s, 400), `${"x".repeat(395)}*** (`);
  // the same for what the login sends of it, in base64
  const echoed = `${"y".repeat(390)}${b64(s.password)} end`;
  const cut = redactAndCut(echoed, s, 400);
  assert.equal(cut, `${"y".repeat(390)}*** end`);
  assert.ok(!cut.includes(b64(s.password).slice(0, 6)));
  // never longer than the cut, and a short text comes back whole (redacted)
  assert.equal(redactAndCut("z".repeat(900), s, 400).length, 400);
  assert.equal(redactAndCut(`535 ${s.password}`, s, 400), "535 ***");
  assert.equal(redactAndCut("", s, 400), "");
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

check("smtpSendPhase: a server that hangs up with a refusal said no, it is never uncertain", () => {
  // With PIPELINING a RCPT TO answered "421" ends the session before DATA: nodemailer reports the reply on a dropped
  // connection. The content never left (it goes only after DATA's 354), so it is the server refusing, not "transfer".
  assert.equal(smtpSendPhase("send", { code: "ECONNECTION", responseCode: 421, command: "CONN" }), "data");
  // The connection closing on an unfinished "554 ..." line, or a refusal nobody asked for, is a refusal too.
  assert.equal(smtpSendPhase("send", { code: "ECONNECTION", responseCode: 554, command: "CONN" }), "data");
  assert.equal(smtpSendPhase("send", { code: "EPROTOCOL", responseCode: 550, command: "CONN" }), "data");
  // No server reply (a drop, a timeout) or no refusal in it: still uncertain.
  assert.equal(smtpSendPhase("send", { code: "ECONNECTION" }), "transfer");
  assert.equal(smtpSendPhase("send", { code: "ETIMEDOUT" }), "transfer");
  assert.equal(smtpSendPhase("send", { code: "ECONNECTION", responseCode: 250 }), "transfer");
  // The envelope and the final answer keep their own phases; the steps before the send don't change.
  assert.equal(smtpSendPhase("send", { code: "EENVELOPE", command: "RCPT TO", responseCode: 421 }), "rcpt");
  assert.equal(smtpSendPhase("send", { code: "EMESSAGE", command: "DATA", responseCode: 421 }), "message");
  assert.equal(smtpSendPhase("connect", { code: "ECONNECTION", responseCode: 421 }), "connect");
  // As a server-level refusal: a 4xx is retried, then pauses; a limit worded with an x.7.x code pauses as such.
  const closing = "421 4.3.2 Service not available, closing transmission channel";
  assert.equal(smtpFailureAction(421, smtpFailureCode("data", 421), closing, 0), "retry");
  assert.equal(smtpFailureAction(421, smtpFailureCode("data", 421), closing, 5), "pause");
  assert.equal(smtpFailureAction(421, "data-421", "421 4.7.0 Too many messages, closing connection", 0), "daily_limit");
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

check("smtpAccountSchema reads the inbox: a blank server is no inbox and the security follows the port", () => {
  const base = { email: "a@b.com", host: "smtpi.kinghost.net", port: 587, security: "starttls", password: "x", hourlyLimit: 100, dailyLimit: 500 };
  const inboxOf = (extra: Record<string, unknown>) => smtpAccountSchema.parse({ ...base, ...extra }).imap;
  const problems = (extra: Record<string, unknown>) => {
    const r = smtpAccountSchema.safeParse({ ...base, ...extra });
    return r.success ? [] : r.error.issues.map((issue) => issue.message);
  };
  // no inbox: the keys left out (every form payload from before the inbox), blank, or only spaces
  for (const extra of [{}, { imapHost: "" }, { imapHost: "   " }, { imapHost: "", imapPort: 143 }, { imapHost: undefined, imapPort: undefined }])
    assert.equal(inboxOf(extra), null, JSON.stringify(extra));
  // the port says how the connection is secured: 993 is TLS from the start, 143 upgrades with STARTTLS
  assert.deepEqual(inboxOf({ imapHost: "imap.kinghost.net", imapPort: 993 }), { host: "imap.kinghost.net", port: 993, security: "ssl" });
  assert.deepEqual(inboxOf({ imapHost: "imap.kinghost.net", imapPort: 143 }), { host: "imap.kinghost.net", port: 143, security: "starttls" });
  // the server is trimmed and lower-cased like the sending one; the port may come as text (a form field)
  assert.deepEqual(inboxOf({ imapHost: " IMAP.KingHost.NET ", imapPort: "143" }), { host: "imap.kinghost.net", port: 143, security: "starttls" });
  assert.deepEqual(inboxOf({ imapHost: "177.153.0.10", imapPort: 993 }), { host: "177.153.0.10", port: 993, security: "ssl" });
  // a server with no port is the usual one: 993, TLS from the start
  assert.deepEqual(inboxOf({ imapHost: "imap.kinghost.net" }), { host: "imap.kinghost.net", port: 993, security: "ssl" });
  // what the person typed is read into `imap` and no longer left beside it (the annotation pins the output type the
  // save action relies on: tsc checks it, not the run)
  const out = smtpAccountSchema.parse({ ...base, imapHost: "imap.kinghost.net", imapPort: 993 });
  const read: ImapSettings | null = out.imap;
  assert.deepEqual(read, { host: "imap.kinghost.net", port: 993, security: "ssl" });
  assert.equal(Object.keys(out).includes("imapHost") || Object.keys(out).includes("imapPort"), false);
  assert.equal(out.host, "smtpi.kinghost.net", "the sending server is untouched");
  // only 993 and 143: never 110 (POP3), 143's neighbours, the sending ports or anything that isn't a whole port
  assert.deepEqual(problems({ imapHost: "imap.kinghost.net", imapPort: 110 }), ["invalid_imap_port"]);
  for (const imapPort of [25, 465, 587, 995, 992, 144, 0, -993, 993.5, "", "abc", "993abc"])
    assert.equal(problems({ imapHost: "imap.kinghost.net", imapPort }).length > 0, true, String(imapPort));
  // the server is a bare name or IPv4, as the sending one is: a pasted URL, a port, a space or a single label is refused
  assert.deepEqual(problems({ imapHost: "imap://x", imapPort: 993 }), ["invalid_imap_host"]);
  for (const imapHost of ["imap://imap.kinghost.net", "imap.kinghost.net:993", "imap kinghost.net", "imap.kinghost.net/inbox", "localhost", "imap.25",
    "[::1]", "-x.example.com", "x-.example.com", "imap_x.example.com", "imap.example.com.", "2130706433", "177.153.0.256"])
    assert.deepEqual(problems({ imapHost, imapPort: 993 }), ["invalid_imap_host"], imapHost);
  assert.equal(problems({ imapHost: `${"x".repeat(250)}.com`, imapPort: 993 }).length > 0, true, "longer than a name can be");
  // a problem with the inbox is its own: it never turns the sending half bad, nor the other way round
  assert.deepEqual(problems({ imapHost: "imap://x", host: "smtp://x" }).sort(), ["invalid_host", "invalid_imap_host"]);
});

check("every inbox failure the form can name has its text in pt.json and en.json", () => {
  const imapErrors = ["auth_failed", "tls_failed", "connection_failed", "host_not_found", "host_not_allowed", "failed"] as const satisfies readonly ImapConnectError[];
  // typecheck fails here when imapConnectError learns a new failure that the form has no text for
  type Unlisted = Exclude<ImapConnectError, (typeof imapErrors)[number]>;
  const everyOneListed: [Unlisted] extends [never] ? true : false = true;
  assert.ok(everyOneListed);
  const keys = [
    ...imapErrors.map((e) => `smtp.error.imap_${e}`),
    "smtp.error.invalid_imap_host",
    "smtp.fieldError.invalid_imap_host",
    "smtp.fieldError.invalid_imap_port",
    "smtp.form.imapSection",
    "smtp.form.imapIntro",
    "smtp.form.imapEnable",
    "smtp.form.imapHost",
    "smtp.form.imapHostPlaceholder",
    "smtp.form.imapHostHint",
    "smtp.form.imapPort",
    "smtp.form.imapPasswordHint",
  ];
  assert.deepEqual(missingEmailKeys(ptMessages, keys), [], "pt.json");
  assert.deepEqual(missingEmailKeys(enMessages, keys), [], "en.json");
  // the messages that interpolate the server and the port name them, in both languages
  for (const catalog of [ptMessages, enMessages]) {
    const text = (key: string) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalog.emailBroadcast) as string;
    for (const e of ["tls_failed", "connection_failed"]) assert.ok(text(`smtp.error.imap_${e}`).includes("{host}:{port}"), e);
  }
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
    "hora", "horas", "dia", "diario", "diário", "diaria", "diária"])
    assert.equal(a(552, "rcpt-552", `Quota exceeded: ${word}`, 0), "daily_limit", word);
  assert.equal(a(552, "rcpt-552", "5.7.1 Mailbox quota exceeded", 0), "daily_limit"); // x.7.x is policy, not the mailbox
  assert.equal(a(552, "data-552", "Over quota", 0), "recipient");
  assert.equal(a(452, "data-452", "Over quota", 0), "retry");
  assert.equal(a(552, "mail-552", "Over quota", 0), "daily_limit"); // at MAIL FROM it is the sender's own quota
});

check("smtpFailureAction reads 'cota' and 'diária', ignores echoed addresses and knows send-as refusals", () => {
  const a = smtpFailureAction;
  // "cota" is a limit word and "diária" a sending word (feminine, like "cota"): the account's daily quota pauses
  assert.equal(a(550, "rcpt-550", "Cota diária de envio excedida", 0), "daily_limit");
  assert.equal(a(550, "rcpt-550", "Cota diária excedida", 0), "daily_limit");
  assert.equal(a(550, "rcpt-550", "Cota diaria excedida", 0), "daily_limit");
  assert.equal(a(550, "mail-550", "Cota atingida", 0), "daily_limit");
  // a mailbox's own "cota", with no sending word, is still that recipient's
  assert.equal(a(552, "rcpt-552", "Cota excedida para o usuario", 0), "recipient");
  assert.equal(a(552, "rcpt-552", "Cota atingida para esta caixa", 0), "recipient");
  assert.equal(a(452, "rcpt-452", "Cota atingida para esta caixa", 0), "retry");
  assert.equal(a(452, "rcpt-452", "Cota atingida para esta caixa", 5), "recipient");
  // an address the server echoes back is a name, not words: "dia@..." or "envio@..." is no sending limit
  assert.equal(a(552, "rcpt-552", "<dia@empresa.com.br>: Mailbox quota exceeded", 0), "recipient");
  assert.equal(a(552, "rcpt-552", "envio@loja.com.br: Mailbox quota exceeded", 0), "recipient");
  assert.equal(a(452, "rcpt-452", "<hora@empresa.com.br>... Over quota", 5), "recipient");
  // the words around the address still count
  assert.equal(a(550, "rcpt-550", "<dia@empresa.com.br>: daily sending quota exceeded", 0), "daily_limit");
  assert.equal(a(550, "rcpt-550", "Limite de envio excedido para <contato@cliente.com.br>", 0), "daily_limit");
  // nor is "cota" at the start of one ("<cotacao@...>", "<cotacoes@...>", "@cotabest..."): it is no limit word, on any rule.
  // A recipient's refusal that also has an x.7.x code or a sending word stays the recipient's (a 4xx retries, then fails it),
  // never "daily_limit": that pause hands the recipient back first in the queue and the resume stalls on it for good
  assert.equal(a(550, "rcpt-550", "5.7.1 <cotacao@fornecedor.com.br>: Recipient address rejected: Access denied", 0), "recipient");
  assert.equal(a(554, "rcpt-554", "5.7.1 <cotacoes@fornecedor.com.br>: Recipient address rejected: Access denied", 0), "recipient");
  assert.equal(a(550, "rcpt-550", "5.7.1 <compras@cotabest.com.br>: Recipient address rejected: Access denied", 0), "recipient");
  assert.equal(a(550, "rcpt-550", "5.7.1 compras@cotabest.com.br: Recipient address rejected: Access denied", 0), "recipient");
  assert.equal(a(550, "rcpt-550", "<cotacao@fornecedor.com.br>: Recipient rejected by sender policy", 0), "recipient");
  assert.equal(a(450, "rcpt-450", "4.7.1 <cotacao@fornecedor.com.br>: Recipient address rejected: Greylisted", 0), "retry");
  assert.equal(a(450, "rcpt-450", "4.7.1 <cotacao@fornecedor.com.br>: Recipient address rejected: Greylisted", 5), "recipient");
  assert.equal(a(554, "message-554", "5.7.1 <cotacao@fornecedor.com.br>: Message rejected", 0), "recipient");
  // at DATA an unknown 5xx pauses with or without such an address; at MAIL FROM it blocks (5xx) or retries (4xx)
  assert.equal(a(554, "data-554", "<cotacao@fornecedor.com.br>: transaction failed", 0), "pause");
  assert.equal(a(550, "mail-550", "<cotacao@empresa.com.br>: Access denied", 0), "blocked");
  assert.equal(a(451, "mail-451", "4.3.0 <cotacao@empresa.com.br>: Temporary lookup failure", 0), "retry");
  // a 421 is the server's whatever address it echoes: it retries, it is not a limit
  assert.equal(a(421, "rcpt-421", "<cotacao@x.com>: Service not available", 0), "retry");
  // the words around such an address still count
  assert.equal(a(550, "rcpt-550", "<cotacao@fornecedor.com.br>: Cota diária de envio excedida", 0), "daily_limit");
  assert.equal(a(552, "rcpt-552", "<cotacao@fornecedor.com.br>: Cota excedida para o usuario", 0), "recipient");
  assert.equal(a(550, "mail-550", "<cotacao@empresa.com.br>: Cota atingida", 0), "daily_limit");
  assert.equal(a(421, "rcpt-421", "<cotacao@x.com>: Too many connections", 0), "daily_limit");
  // Office 365's send-as refusals are the account's, on whichever command they come back
  assert.equal(a(554, "message-554", "5.2.252 SendAsDenied; user@x not allowed to send as y@z", 0), "blocked");
  assert.equal(a(550, "message-550", "5.7.60 SMTP; Client does not have permissions to send as this sender", 0), "blocked");
  for (const phase of ["mail", "rcpt", "data", "message"])
    for (const text of ["SendAsDenied", "Client does not have permission to send as this sender", "user is not allowed to send as x@y"])
      assert.equal(a(550, `${phase}-550`, text, 0), "blocked", `${phase}: ${text}`);
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

/** The keys (under emailBroadcast) that a message catalog has no text for. */
function missingEmailKeys(catalog: object, keys: readonly string[]): string[] {
  return keys.filter((key) => {
    let node: unknown = (catalog as { emailBroadcast?: unknown }).emailBroadcast;
    for (const part of key.split(".")) node = node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
    return typeof node !== "string";
  });
}

check("every paused and failure text key the helpers return exists in pt.json and en.json", () => {
  const channels = ["PLATFORM", "MICROSOFT", "GOOGLE", "SMTP"] as const satisfies readonly MailboxChannel[];
  const failures = ["invalid_address", "message_too_large", "interrupted", "generic"] as const satisfies readonly RecipientFailureKey[];
  // typecheck fails here when a channel or a failure key is added to failure-reason.ts without being listed above
  type Unlisted = Exclude<MailboxChannel, (typeof channels)[number]> | Exclude<RecipientFailureKey, (typeof failures)[number]>;
  const everyOneListed: [Unlisted] extends [never] ? true : false = true;
  assert.ok(everyOneListed);
  const keys = new Set<string>();
  for (const channel of channels) {
    for (const reason of PAUSED_REASONS) {
      keys.add(pausedMessageKey(channel, reason));
      keys.add(listPausedMessageKey(channel, reason));
    }
    for (const failure of failures) keys.add(failureMessageKey(channel, failure));
  }
  const all = [...keys];
  assert.ok(all.includes("paused.smtp_reconnect") && all.includes("failure.smtp_message_too_large"), "the SMTP wordings are among them");
  assert.deepEqual(missingEmailKeys(ptMessages, all), [], "pt.json");
  assert.deepEqual(missingEmailKeys(enMessages, all), [], "en.json");
  // the check bites: a catalog that lost one of them, or holds a group where a text should be, is caught
  const pruned = structuredClone(ptMessages) as { emailBroadcast: { paused: Record<string, unknown> } };
  delete pruned.emailBroadcast.paused.smtp_reconnect;
  pruned.emailBroadcast.paused.quota = { text: "x" };
  assert.deepEqual(missingEmailKeys(pruned, all).sort(), ["paused.quota", "paused.smtp_reconnect"]);
});

// --- Microsoft inbox ---------------------------------------------------------
check("inbox tab, filter and search come from the URL with safe defaults", () => {
  assert.equal(mailboxTabFromParam("caixa"), "caixa");
  assert.equal(mailboxTabFromParam(undefined), "envios");
  assert.equal(mailboxTabFromParam("x"), "envios");
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

check("inboxHref carries the SMTP channel when asked", () => {
  assert.equal(
    inboxHref({ canal: "smtp", filtro: "nao-lidas", q: "x", msg: "1.2" }),
    "/app/email?canal=smtp&aba=caixa&filtro=nao-lidas&q=x&msg=1.2",
  );
  assert.equal(inboxHref({ canal: "smtp" }), "/app/email?canal=smtp&aba=caixa");
  assert.equal(inboxHref({ canal: "microsoft" }), inboxHref());
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

check("normalizeSubject takes the same prefixes however they are spaced, and no others", () => {
  // Spacing around the word, the counter and the colon; markers glued together or mixed with [tags] and *tags*.
  assert.equal(normalizeSubject("  re [2] :  Oi"), "oi");
  assert.equal(normalizeSubject("RES[10] :Oi"), "oi");
  assert.equal(normalizeSubject("Re:Re:Re:Oi"), "oi");
  assert.equal(normalizeSubject("auto-reply: out of office : Oi"), "oi");
  assert.equal(normalizeSubject("autoreply: ausente: Oi"), "oi");
  assert.equal(normalizeSubject("Re: [a] *b* TR: Oi"), "oi");
  assert.equal(normalizeSubject("FW:[EXT]*x*  Re :Oi"), "oi");
  assert.equal(normalizeSubject("Resposta automatica : Oi"), "oi");
  assert.equal(normalizeSubject("Re: Re: "), "");
  for (const word of ["re", "res", "enc", "fw", "fwd", "tr", "aw", "wg", "sv", "antw", "ausente"]) {
    assert.equal(normalizeSubject(`${word.toUpperCase()}: Oi`), "oi", word);
  }
  // A word that merely starts like a marker, a marker with no colon, a counter that isn't digits: not prefixes.
  assert.equal(normalizeSubject("Resultado: Oi"), "resultado: oi");
  assert.equal(normalizeSubject("Trabalho: Oi"), "trabalho: oi");
  assert.equal(normalizeSubject("Re x: Oi"), "re x: oi");
  assert.equal(normalizeSubject("Re[x]: Oi"), "re[x]: oi");
  assert.equal(normalizeSubject("Re[]: Oi"), "re[]: oi");
  assert.equal(normalizeSubject("Re[2] x: Oi"), "re[2] x: oi");
  assert.equal(normalizeSubject("[a]x: Oi"), "x: oi");
});

check("normalizeSubject stays linear on a subject padded with spaces", () => {
  // A sender controls the subject. With two \s* either side of an optional group, each of these took about a minute.
  const spaces = " ".repeat(200_000);
  const cases: [subject: string, normalized: string][] = [
    [`re${spaces}x`, "re x"],
    [`re: re${spaces}x`, "re x"],
    [`${spaces}re${spaces}x`, "re x"],
    [`fwd [2]${spaces}x`, "fwd [2] x"],
  ];
  for (const [subject, normalized] of cases) {
    let result = "";
    const took = millis(() => {
      result = normalizeSubject(subject);
    });
    assert.ok(took < 250, `${JSON.stringify(subject.slice(0, 10))}... took ${took.toFixed(0)} ms`);
    assert.equal(result, normalized);
  }
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

// --- IMAP inbox (SMTP account) ------------------------------------------------
check("suggestImapHost swaps the SMTP label for imap and leaves other hosts alone", () => {
  for (const smtp of ["smtpi.kinghost.net", "smtp.kinghost.net", "SMTPI.KingHost.NET", "  smtp.kinghost.net "]) {
    assert.equal(suggestImapHost(smtp), "imap.kinghost.net", smtp);
  }
  assert.equal(suggestImapHost("smtpi.uni5.net"), "imap.uni5.net");
  assert.equal(suggestImapHost("smtp.hostinger.com"), "imap.hostinger.com");
  assert.equal(suggestImapHost("smtp.mail.yahoo.com"), "imap.mail.yahoo.com");
  assert.equal(suggestImapHost("smtps.empresa.com.br"), "imap.empresa.com.br");
  // Only the first label and only those exact words: anything else is the same host.
  assert.equal(suggestImapHost("mail.empresa.com.br"), "mail.empresa.com.br");
  assert.equal(suggestImapHost("smtp-relay.empresa.com.br"), "smtp-relay.empresa.com.br");
  assert.equal(suggestImapHost("mail.smtp.empresa.com.br"), "mail.smtp.empresa.com.br");
  assert.equal(suggestImapHost("smtp"), "smtp");
  assert.equal(suggestImapHost(""), "");
});

check("IMAP offers 993 (SSL) and 143 (STARTTLS), each with its own default security", () => {
  assert.deepEqual([...IMAP_PORTS], [993, 143]);
  assert.equal(defaultImapSecurity(993), "ssl");
  assert.equal(defaultImapSecurity(143), "starttls");
});

check("imapMessageRef and parseImapMessageRef agree and refuse anything but <uidvalidity>.<uid>", () => {
  assert.equal(imapMessageRef(123, 45), "123.45");
  assert.deepEqual(parseImapMessageRef("123.45"), { uidValidity: 123, uid: 45 });
  assert.deepEqual(parseImapMessageRef(imapMessageRef(7, 9)), { uidValidity: 7, uid: 9 });
  // UIDs and UIDVALIDITY are 32-bit numbers and never zero.
  assert.deepEqual(parseImapMessageRef("4294967295.4294967295"), { uidValidity: 4294967295, uid: 4294967295 });
  const refused = ["0.45", "12.0", "a.1", "1", "1.2.3", " 1.2", "1.2 ", "1.2\n", "4294967296.1", "1.4294967296"];
  refused.push("01.2", "1.02", "-1.2", "1.-2", "1e3.2", "1.2e3", "", ".", "1.", ".1", "99999999999999999999.1");
  for (const bad of refused) assert.equal(parseImapMessageRef(bad), null, JSON.stringify(bad));
  for (const bad of [12, 1.2, null, undefined, {}, ["1.2"]]) assert.equal(parseImapMessageRef(bad), null);
});

check("isAttachmentIndex takes one to three digits and nothing else", () => {
  for (const ok of ["0", "12", "999"]) assert.equal(isAttachmentIndex(ok), true, ok);
  for (const bad of ["1234", "-1", "1.2", "a", "", " 1", "1 ", "1\n", 12, null, undefined]) {
    assert.equal(isAttachmentIndex(bad), false, String(bad));
  }
});

check("imapConnectError names the failure the form shows", () => {
  const e = imapConnectError;
  assert.equal(e({ authenticationFailed: true }), "auth_failed");
  assert.equal(e({ authenticationFailed: true, code: "ECONNRESET" }), "auth_failed", "a refused login wins");
  assert.equal(e({ code: "ENOTFOUND" }), "host_not_found");
  assert.equal(e({ code: "EAI_AGAIN" }), "host_not_found");
  for (const code of [
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "CERT_HAS_EXPIRED",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ERR_SSL_WRONG_VERSION_NUMBER",
  ]) {
    assert.equal(e({ code }), "tls_failed", code);
  }
  // imapflow flags a server without STARTTLS (port 143 never falls back to plain text) only by its message.
  assert.equal(e({ message: "Server does not support STARTTLS" }), "tls_failed");
  assert.equal(e({ message: "self-signed certificate in certificate chain" }), "tls_failed");
  for (const code of [
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ETIMEOUT",
    "CONNECT_TIMEOUT",
    "GREETING_TIMEOUT",
    "NoConnection",
    "ClosedAfterConnectTLS",
  ]) {
    assert.equal(e({ code }), "connection_failed", code);
  }
  assert.equal(e({}), "failed");
  assert.equal(e({ code: null, message: null }), "failed");
  assert.equal(e({ code: "SOMETHING", message: "boom" }), "failed");
});

check("pickSentFolder prefers the \\Sent mark, then the usual names in the spec's order", () => {
  assert.equal(pickSentFolder([{ path: "INBOX" }, { path: "INBOX.Sent" }]), "INBOX.Sent"); // KingHost
  assert.equal(pickSentFolder([{ path: "Sent Mail", specialUse: "\\Sent" }, { path: "Sent" }]), "Sent Mail");
  assert.equal(pickSentFolder([{ path: "Sent" }, { path: "Arquivo", specialUse: "\\Sent" }]), "Arquivo", "the mark beats a name listed first");
  assert.equal(pickSentFolder([{ path: "enviados" }]), "enviados");
  assert.equal(pickSentFolder([{ path: "Sent Items" }, { path: "Sent" }, { path: "INBOX.Sent" }]), "INBOX.Sent", "names go by preference, not folder order");
  assert.equal(pickSentFolder([{ path: "Itens Enviados" }, { path: "Sent Items" }]), "Sent Items");
  assert.equal(pickSentFolder([{ path: "INBOX.Drafts", specialUse: "\\Drafts" }, { path: "INBOX", specialUse: null }]), null);
  assert.equal(pickSentFolder([{ path: "INBOX" }]), null);
  assert.equal(pickSentFolder([]), null);
});

check("replyHeaders threads the reply with In-Reply-To and References and writes Re: once", () => {
  assert.deepEqual(replyHeaders({ subject: "Promoção", messageId: "<a@x>", references: ["<r1@x>"] }), {
    subject: "Re: Promoção",
    headers: { "In-Reply-To": "<a@x>", References: "<r1@x> <a@x>" },
  });
  const subjectOf = (subject: string) => replyHeaders({ subject, messageId: "<a@x>", references: [] }).subject;
  assert.equal(subjectOf("RE: oi"), "RE: oi");
  assert.equal(subjectOf("Res: oi"), "Res: oi");
  assert.equal(subjectOf("Re[2]: oi"), "Re[2]: oi");
  assert.equal(subjectOf(" re : oi"), "re : oi");
  assert.equal(subjectOf("re [2] : oi"), "re [2] : oi");
  assert.equal(subjectOf("RES[10]:oi"), "RES[10]:oi");
  assert.equal(subjectOf("Re:Re: oi"), "Re:Re: oi");
  // Words that only start like a marker, a marker with no colon, a counter that isn't digits, and forwards, still get one.
  assert.equal(subjectOf("Resultado do mês"), "Re: Resultado do mês");
  assert.equal(subjectOf("Reunião"), "Re: Reunião");
  assert.equal(subjectOf("Rex: oi"), "Re: Rex: oi");
  assert.equal(subjectOf("Ress: oi"), "Re: Ress: oi");
  assert.equal(subjectOf("Re x: oi"), "Re: Re x: oi");
  assert.equal(subjectOf("Re[x]: oi"), "Re: Re[x]: oi");
  assert.equal(subjectOf("Re[]: oi"), "Re: Re[]: oi");
  assert.equal(subjectOf("Re[2] x: oi"), "Re: Re[2] x: oi");
  assert.equal(subjectOf("Re[2]x: oi"), "Re: Re[2]x: oi");
  assert.equal(subjectOf("Fwd: oi"), "Re: Fwd: oi");
  assert.equal(subjectOf("  "), "Re:");
  // No Message-ID to answer: nothing to thread on, whatever the chain says.
  assert.deepEqual(replyHeaders({ subject: "oi", messageId: null, references: ["<r1@x>"] }), { subject: "Re: oi", headers: {} });
  // No chain yet: the References is the parent's id alone; an id already in the chain isn't repeated.
  assert.deepEqual(replyHeaders({ subject: "oi", messageId: "<a@x>", references: [] }).headers, {
    "In-Reply-To": "<a@x>",
    References: "<a@x>",
  });
  assert.equal(replyHeaders({ subject: "oi", messageId: "<a@x>", references: ["<a@x>", "<b@x>"] }).headers.References, "<a@x> <b@x>");
});

check("replyHeaders keeps what the sender wrote out of the reply's headers", () => {
  const r = replyHeaders({
    subject: "oi\r\nBcc: x@y.com",
    messageId: "<a@x>",
    references: ["<r1@x> <r2@x>", "lixo", "<r3@x>\r\nBcc: z@y.com"],
  });
  assert.equal(r.subject, "Re: oi Bcc: x@y.com");
  assert.deepEqual(r.headers, { "In-Reply-To": "<a@x>", References: "<r1@x> <r2@x> <r3@x> <a@x>" });
  for (const messageId of ["<a@x>\r\nBcc: z@y.com", "sem-colchetes", "<a b@x>", "<>", ""]) {
    assert.deepEqual(replyHeaders({ subject: "oi", messageId, references: ["<r1@x>"] }).headers, {}, JSON.stringify(messageId));
  }
});

check("replyHeaders drops a message id past 998 characters, and the reply goes out without that threading header", () => {
  // The id between the angle brackets holds at most 998 characters (the line limit); a sender's header, or the server's envelope,
  // holds as many as the sender likes, and the id is copied into In-Reply-To and References.
  const idOf = (inner: number) => `<${"a".repeat(inner)}>`;
  const headersOf = (messageId: string | null, references: string[] = []) =>
    replyHeaders({ subject: "oi", messageId, references }).headers;
  assert.deepEqual(headersOf(idOf(998)), { "In-Reply-To": idOf(998), References: idOf(998) }, "998 is the largest id kept");
  assert.deepEqual(headersOf(idOf(999)), {}, "999 is not");
  // The reply is the same without the threading headers: the subject is still "Re: ...".
  assert.equal(replyHeaders({ subject: "oi", messageId: idOf(999), references: ["<r1@x>"] }).subject, "Re: oi");
  // A too long id in the chain is left out of it, the others stay in order; and a too long References leaves the reply threaded on the parent.
  assert.deepEqual(headersOf("<a@x>", [idOf(999), "<r1@x>", idOf(998)]), {
    "In-Reply-To": "<a@x>",
    References: `<r1@x> ${idOf(998)} <a@x>`,
  });
  // A megabyte of id: dropped, at once.
  const huge = idOf(1_000_000);
  let headers: Record<string, string> = {};
  const took = millis(() => {
    headers = headersOf(huge, [huge, "<r1@x>"]);
  });
  assert.deepEqual(headers, {}, "the parent's id is the huge one: nothing to thread on");
  assert.ok(took < 250, `${took.toFixed(0)} ms`);
  // The same through replyHeadersForSend, which is what is sent.
  assert.deepEqual(replyHeadersForSend({ subject: "oi", messageId: huge, references: [huge] }).headers, {});
  assert.deepEqual(replyHeadersForSend({ subject: "oi", messageId: "<a@x>", references: [huge, "<r1@x>"] }).headers, {
    "In-Reply-To": "<a@x>",
    References: "<r1@x> <a@x>",
  });
});

check("the Message-ID of a reply is held to 998 characters whether it comes from the header block or from the envelope", () => {
  // What planReply (imap/inbox.ts) does: the id of the header block when there is one, else the envelope's, then replyHeadersForSend.
  const plan = (block: string, envelopeId: string | null) => {
    const ids = threadIdsFromHeaders(block);
    return replyHeadersForSend({ subject: "oi", messageId: ids.messageId ?? envelopeId, references: ids.references }).headers;
  };
  const idOf = (inner: number) => `<${"a".repeat(inner)}>`;
  const huge = idOf(1_000_000);
  const normal = "Message-ID: <m1@x>\r\nReferences: <r0@x>\r\n\r\n";
  const none = "References: <r0@x>\r\n\r\n";
  // The block's id is read to at most 998 characters (ID_TOKEN_RE): a longer one yields none, so the envelope's stands in...
  assert.equal(threadIdsFromHeaders(`Message-ID: ${idOf(999)}\r\n\r\n`).messageId, null);
  assert.equal(threadIdsFromHeaders(`Message-ID: ${idOf(998)}\r\n\r\n`).messageId, idOf(998));
  assert.equal(threadIdsFromHeaders(`Message-ID: ${huge}\r\n\r\n`).messageId, null);
  // ...and the envelope's is held to the same bound: before, a megabyte of it became a megabyte In-Reply-To.
  assert.deepEqual(plan(`Message-ID: ${huge}\r\n\r\n`, huge), {}, "too long in the block and in the envelope");
  assert.deepEqual(plan(none, huge), {}, "no id in the block, a too long one in the envelope");
  assert.deepEqual(plan(none, idOf(999)), {}, "999 characters from the envelope");
  assert.deepEqual(plan(none, idOf(998)), { "In-Reply-To": idOf(998), References: `<r0@x> ${idOf(998)}` }, "998 from the envelope is kept");
  // The ordinary cases stay as they were: the block's id wins; with none there, the envelope's is used.
  assert.deepEqual(plan(normal, huge), { "In-Reply-To": "<m1@x>", References: "<r0@x> <m1@x>" });
  assert.deepEqual(plan(none, "<env@x>"), { "In-Reply-To": "<env@x>", References: "<r0@x> <env@x>" });
  assert.deepEqual(plan(none, null), {});
});

check("replyHeaders stays linear on a subject padded with spaces", () => {
  // The subject comes straight from the server. With two \s* either side of an optional group, each of these took about a minute.
  const spaces = " ".repeat(200_000);
  for (const subject of [`re${spaces}x`, `res [2]${spaces}x`, `${spaces}re${spaces}x`]) {
    let subjectOut = "";
    const took = millis(() => {
      subjectOut = replyHeaders({ subject, messageId: "<a@x>", references: [] }).subject;
    });
    assert.ok(took < 250, `${JSON.stringify(subject.slice(0, 10))}... took ${took.toFixed(0)} ms`);
    // No colon, so it is no marker: the reply gets its own "Re:" (the padding at the ends is trimmed, as ever).
    assert.equal(subjectOut, `Re: ${subject.trim()}`);
  }
});

check("replyOutcome tells a sent reply from an uncertain one and a refused one", () => {
  const fail = (status: number, stage: "prepare" | "send"): MailboxSendOutcome => ({
    ok: false,
    status,
    code: null,
    message: "x",
    retryAfter: null,
    stage,
  });
  assert.equal(replyOutcome({ ok: true }), "sent");
  assert.equal(replyOutcome(fail(0, "send")), "uncertain", "a network failure while handing it over may have gone out");
  assert.equal(replyOutcome(fail(550, "send")), "failed");
  assert.equal(replyOutcome(fail(421, "send")), "failed");
  assert.equal(replyOutcome(fail(0, "prepare")), "failed", "nothing left before the hand-over");
  assert.equal(replyOutcome(fail(535, "prepare")), "failed");
});

check("replyAddress answers to the Reply-To, else the From, and only to a plain mailbox", () => {
  const one = (address: string) => [{ address }];
  assert.equal(replyAddress([one("resp@x.com"), one("from@x.com")]), "resp@x.com");
  assert.equal(replyAddress([undefined, one("from@x.com")]), "from@x.com");
  assert.equal(replyAddress([[], one("from@x.com")]), "from@x.com");
  // A Reply-To with nothing usable in it (a group has no address, a name alone neither) is as good as none.
  assert.equal(replyAddress([[{ address: "" }, { address: null }, {}], one("from@x.com")]), "from@x.com");
  assert.equal(replyAddress([one("Nome <resp@x.com>"), one("from@x.com")]), "from@x.com");
  // In a list, the first usable one, in order; a list is only looked at when the one before it gave nothing.
  assert.equal(replyAddress([[{ address: "lixo" }, { address: "dois@x.com" }, { address: "tres@x.com" }]]), "dois@x.com");
  assert.equal(replyAddress([one("resp@x.com"), one("from@x.com")]), "resp@x.com");
  assert.equal(replyAddress([one("  espacos@x.com\r\n")]), "espacos@x.com", "only the ends are trimmed");
  assert.equal(replyAddress([one("a@b.com ")]), "a@b.com");
  assert.equal(replyAddress([]), null);
  assert.equal(replyAddress([undefined, []]), null);
  assert.equal(replyAddress([one("lixo")]), null);
  // The address is returned as the sender wrote it (the domain is not case sensitive and the local part may be).
  assert.equal(replyAddress([one("Varandas@Empresa.COM.BR")]), "Varandas@Empresa.COM.BR");
  for (const ok of [
    "a@b.co",
    "nome.sobrenome@empresa.com.br",
    "a+tag@x.com",
    "o'brien@x.com",
    "a_b-c@sub.dominio.com.br",
    "a=b@x.com",
    "a@xn--exemplo-9ua.com.br",
    "a@b.c-d.com",
    "1@2.org",
    `${"a".repeat(64)}@x.com`,
  ]) {
    assert.equal(replyAddress([one(ok)]), ok, ok);
  }
  // What could end the RCPT TO line, add a recipient, route the mail elsewhere or isn't an address at all.
  for (const bad of [
    "a@b.co\r\nRCPT TO:<x@y.com>",
    "a@b.co>\r\nMAIL FROM:<x@y.com>",
    "a>@b.co",
    "a\nb@c.com",
    "a b@c.com",
    "a@b.com,c@d.com",
    "a@b.com;c@d.com",
    "<a@b.com>",
    "Nome <a@b.com>",
    '"a b"@c.com',
    '"a>RCPT TO:<z"@c.com',
    "a@[127.0.0.1]",
    "a@127.0.0.1",
    "a@localhost",
    "a@b",
    "a@.com",
    "a@b..com",
    "a@-b.com",
    "a@b-.com",
    "a@b.com.",
    "a@b.c",
    ".a@b.com",
    "a.@b.com",
    "a..b@c.com",
    "a%c@d.com",
    "a|b@c.com",
    "a`b@c.com",
    "a$b@c.com",
    "a\\b@c.com",
    "ação@x.com",
    "a@exemplo.çom",
    "a\0@b.com",
    "a@@b.com",
    "a@b@c.com",
    "@b.com",
    "a@",
    "",
    `${"a".repeat(65)}@x.com`,
    `a@${"b".repeat(64)}.com`,
    `a@${"b.".repeat(130)}com`,
  ]) {
    assert.equal(replyAddress([one(bad)]), null, JSON.stringify(bad));
  }
  // Linear: the sender's text is cut by its length before any pattern reads it.
  for (const bad of ["a".repeat(2_000_000), `a@${"b".repeat(2_000_000)}`, `a@${"b.".repeat(1_000_000)}`]) {
    let answered: string | null = "";
    const took = millis(() => {
      answered = replyAddress([one(bad)]);
    });
    assert.equal(answered, null);
    assert.ok(took < 250, `${bad.slice(0, 8)}... took ${took.toFixed(0)} ms`);
  }
});

check("threadIdsFromHeaders reads the Message-ID and the References chain out of a fetched header block", () => {
  const block = [
    "Message-ID: <m1@exemplo.com.br>",
    "References: <raiz@exemplo.com.br> <meio@exemplo.com.br>",
    " <ultimo@exemplo.com.br>",
    "",
    "",
  ].join("\r\n");
  assert.deepEqual(threadIdsFromHeaders(block), {
    messageId: "<m1@exemplo.com.br>",
    references: ["<raiz@exemplo.com.br>", "<meio@exemplo.com.br>", "<ultimo@exemplo.com.br>"],
  });
  // The header name in any case, a comment after the id (the server's envelope would keep it), tabs, bare line feeds.
  assert.deepEqual(threadIdsFromHeaders("MESSAGE-id:\t<a@x> (comentario <b@x>)\nreferences: <r1@x>\n\t<r2@x>\n\n"), {
    messageId: "<a@x>",
    references: ["<r1@x>", "<r2@x>"],
  });
  // Several References lines add up, in order; the first Message-ID is the one.
  assert.deepEqual(threadIdsFromHeaders("References: <r1@x>\r\nMessage-ID: <a@x>\r\nReferences: <r2@x>\r\nMessage-ID: <b@x>\r\n\r\n"), {
    messageId: "<a@x>",
    references: ["<r1@x>", "<r2@x>"],
  });
  // Nothing usable: no header, no ids, words that aren't ids, an empty block.
  for (const empty of ["", "\r\n\r\n", "Message-ID: sem-colchetes\r\nReferences: lixo <>\r\n\r\n", "Subject: <a@x>\r\n\r\n", ": <a@x>\r\n"]) {
    assert.deepEqual(threadIdsFromHeaders(empty), { messageId: null, references: [] }, JSON.stringify(empty));
  }
  // An id is printable ASCII with no space or bracket inside, so nothing a sender writes in a header can leave it. (The
  // <b@x> inside the junk <a<b@x> is a well-formed id of its own.)
  assert.deepEqual(threadIdsFromHeaders("Message-ID: <a b@x>\r\nReferences: <ã@x> <ok@x> <a<b@x> <a@x\u0000>\r\n\r\n"), {
    messageId: null,
    references: ["<ok@x>", "<b@x>"],
  });
  // Another header is never read as one of these, however it is spelled.
  assert.deepEqual(threadIdsFromHeaders("X-References: <a@x>\r\nIn-Reply-To: <b@x>\r\nMessage-ID-2: <c@x>\r\n\r\n"), { messageId: null, references: [] });
  // Only the first THREAD_HEADERS_MAX_CHARS are read, and a huge block is read in no time.
  const filler = `Message-ID: <a@x>\r\nReferences: ${"<r@x> ".repeat(100)}\r\n`;
  const huge = `${filler}X-Padding: ${"y".repeat(THREAD_HEADERS_MAX_CHARS)}\r\nReferences: <depois@x>\r\n\r\n`;
  assert.ok(!threadIdsFromHeaders(huge).references.includes("<depois@x>"), "past the window");
  assert.equal(threadIdsFromHeaders(huge).references.length, 100);
  for (const text of [`References: ${"<a@x>".repeat(2_000_000)}`, `References: ${"<".repeat(5_000_000)}`, `References: <${"a".repeat(5_000_000)}`]) {
    const took = millis(() => threadIdsFromHeaders(text));
    assert.ok(took < 250, `${text.slice(0, 20)}... took ${took.toFixed(0)} ms`);
  }
});

check("replyHeadersForSend writes the subject on one short line and keeps the newest ids of the chain", () => {
  const subjectOf = (subject: string) => replyHeadersForSend({ subject, messageId: "<a@x>", references: [] }).subject;
  assert.equal(subjectOf("Promoção   de\toutubro"), "Re: Promoção de outubro", "blanks collapse (replyHeaders keeps them on purpose)");
  assert.equal(subjectOf("  RE:    oi  "), "RE: oi");
  assert.equal(subjectOf("oi\r\nBcc: x@y.com"), "Re: oi Bcc: x@y.com", "a line break never reaches a header");
  assert.equal(subjectOf("oi\u0000\u0085\u007fmundo"), "Re: oi mundo", "control characters are blanks");
  assert.equal(subjectOf("a b"), "Re: a b");
  assert.equal(subjectOf(""), "Re:");
  assert.equal(subjectOf("\r\n \t"), "Re:");
  // Cut to REPLY_SUBJECT_MAX_CHARS, "Re: " included, without a blank at the end.
  const long = subjectOf("x".repeat(5_000));
  assert.equal(long.length, REPLY_SUBJECT_MAX_CHARS);
  assert.ok(long.startsWith("Re: xxxx"));
  const room = REPLY_SUBJECT_MAX_CHARS - "Re: ".length;
  const atBlank = subjectOf(`${"x".repeat(room - 1)} ${"y".repeat(50)}`);
  assert.equal(atBlank, `Re: ${"x".repeat(room - 1)}`, "the blank the cut leaves is dropped");
  assert.equal(subjectOf("x".repeat(room)), `Re: ${"x".repeat(room)}`, "exactly the limit is kept whole");
  // An emoji (two UTF-16 units) is never cut in half.
  for (const pad of [room - 1, room, room - 2]) {
    const cut = subjectOf(`${"x".repeat(pad)}${"😀".repeat(100)}`);
    assert.ok(cut.length <= REPLY_SUBJECT_MAX_CHARS);
    // A lone surrogate does not survive being written as UTF-8 and read back.
    assert.equal(Buffer.from(cut, "utf8").toString("utf8"), cut, `a lone surrogate at ${pad}`);
  }
  // Linear on a subject padded with blanks or with control characters.
  for (const subject of [" ".repeat(2_000_000), `x${" ".repeat(2_000_000)}y`, "\u0000".repeat(2_000_000), `re${" ".repeat(2_000_000)}x`]) {
    let out = "";
    const took = millis(() => {
      out = subjectOf(subject);
    });
    assert.ok(took < 250, `${JSON.stringify(subject.slice(0, 6))}... took ${took.toFixed(0)} ms`);
    assert.ok(out.length <= REPLY_SUBJECT_MAX_CHARS);
  }
  // The threading is replyHeaders': In-Reply-To the original's id, the chain and then that id.
  assert.deepEqual(replyHeadersForSend({ subject: "oi", messageId: "<a@x>", references: ["<r@x>"] }).headers, {
    "In-Reply-To": "<a@x>",
    References: "<r@x> <a@x>",
  });
  assert.deepEqual(replyHeadersForSend({ subject: "oi", messageId: null, references: ["<r@x>"] }), { subject: "Re: oi", headers: {} });
  // A long chain keeps its newest ids; the original's own id stays last. A short one is left alone.
  const ids = Array.from({ length: 100 }, (_, i) => `<r${i}@x>`);
  const kept = replyHeadersForSend({ subject: "oi", messageId: "<a@x>", references: ids }).headers.References.split(" ");
  assert.equal(kept.length, REPLY_REFERENCES_MAX);
  assert.deepEqual(kept.slice(-2), ["<r99@x>", "<a@x>"]);
  assert.equal(kept[0], `<r${100 - (REPLY_REFERENCES_MAX - 1)}@x>`);
  const exact = ids.slice(0, REPLY_REFERENCES_MAX - 1);
  assert.equal(replyHeadersForSend({ subject: "oi", messageId: "<a@x>", references: exact }).headers.References.split(" ").length, REPLY_REFERENCES_MAX);
});

check("summaryFromImap turns an envelope into a list row", () => {
  const item = {
    uid: 9,
    uidValidity: 7,
    subject: null,
    from: [{ name: "Fulano", address: "Fulano@X.com" }],
    date: new Date("2026-10-23T13:00:00Z"),
    seen: true,
    hasAttachments: false,
  };
  assert.deepEqual(summaryFromImap(item), {
    id: "7.9",
    subject: "",
    from: { name: "Fulano", email: "fulano@x.com" },
    receivedAt: "2026-10-23T13:00:00.000Z",
    isRead: true,
    hasAttachments: false,
    preview: "",
  });
  // Nothing usable: no sender, an unreadable date, a padded subject. The list still renders.
  assert.deepEqual(summaryFromImap({ ...item, subject: "  Oi  ", from: [], date: new Date(NaN), seen: false, hasAttachments: true }), {
    id: "7.9",
    subject: "Oi",
    from: { name: null, email: null },
    receivedAt: "1970-01-01T00:00:00.000Z",
    isRead: false,
    hasAttachments: true,
    preview: "",
  });
  // The sender is the first entry that has an address; a name alone still shows.
  assert.deepEqual(summaryFromImap({ ...item, from: [{ name: "Sem endereço" }, { address: "B@x.com" }] }).from, { name: null, email: "b@x.com" });
  assert.deepEqual(summaryFromImap({ ...item, from: [{ name: " Só nome " }] }).from, { name: "Só nome", email: null });
});

check("hasAttachmentsInStructure flags files, not the body or the images in it", () => {
  const text: ImapBodyNode = { type: "text/plain" };
  const html: ImapBodyNode = { type: "text/html" };
  const body: ImapBodyNode = { type: "multipart/alternative", childNodes: [text, html] };
  const pdf: ImapBodyNode = {
    type: "application/pdf",
    disposition: "attachment",
    dispositionParameters: { filename: "tabela.pdf" },
    parameters: { name: "tabela.pdf" },
  };
  assert.equal(hasAttachmentsInStructure({ type: "multipart/mixed", childNodes: [body, pdf] }), true);
  assert.equal(hasAttachmentsInStructure(body), false);
  assert.equal(hasAttachmentsInStructure(text), false);
  assert.equal(hasAttachmentsInStructure(undefined), false);
  // An inline image with no name belongs to the body.
  const logo: ImapBodyNode = { type: "image/png", disposition: "inline" };
  assert.equal(hasAttachmentsInStructure({ type: "multipart/related", childNodes: [html, logo] }), false);
  assert.equal(hasAttachmentsInStructure({ type: "multipart/mixed", childNodes: [text, logo] }), false);
  // So does a named one in multipart/related (Gmail names its embedded images), as Graph's hasAttachments skips inline parts...
  const named: ImapBodyNode = { type: "image/png", disposition: "inline", dispositionParameters: { filename: "image001.png" } };
  assert.equal(hasAttachmentsInStructure({ type: "multipart/related", childNodes: [html, named] }), false);
  // ...but a named file shown inline in multipart/mixed (Apple Mail does that with PDFs) is a file, and so is one with no disposition.
  const inlinePdf: ImapBodyNode = { type: "application/pdf", disposition: "inline", dispositionParameters: { filename: "x.pdf" } };
  assert.equal(hasAttachmentsInStructure({ type: "multipart/mixed", childNodes: [text, inlinePdf] }), true);
  const zip: ImapBodyNode = { type: "application/zip", parameters: { name: "a.zip" } };
  assert.equal(hasAttachmentsInStructure({ type: "multipart/mixed", childNodes: [text, zip] }), true);
  // An explicit attachment counts wherever it sits, including inside a forwarded message.
  assert.equal(hasAttachmentsInStructure({ type: "multipart/related", childNodes: [html, pdf] }), true);
  const forwarded: ImapBodyNode = { type: "message/rfc822", childNodes: [{ type: "multipart/mixed", childNodes: [text, pdf] }] };
  assert.equal(hasAttachmentsInStructure({ type: "multipart/mixed", childNodes: [text, forwarded] }), true);
  assert.equal(hasAttachmentsInStructure({ type: "multipart/mixed", childNodes: [text, { type: "message/rfc822", disposition: "attachment" }] }), true);
});

// --- IMAP: the parsed e-mail as the reading pane shows it ---------------------------
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4 tabela de precos");
const SUMMARY: InboxMessageSummary = {
  id: "7.9",
  subject: "Tabela",
  from: { name: "Ana", email: "ana@x.com" },
  receivedAt: "2026-10-23T13:00:00.000Z",
  isRead: false,
  hasAttachments: true,
  preview: "",
};
const arrayBufferOf = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const parsedEmail = (over: Partial<Email> = {}): Email => ({ headers: [], headerLines: [], attachments: [], ...over });
const part = (over: Partial<Attachment> & Pick<Attachment, "mimeType">): Attachment => ({
  filename: null,
  disposition: null,
  content: new ArrayBuffer(0),
  ...over,
});
const dataUris = (doc: string) => doc.split("data:image/png;base64,").length - 1;

check("detailFromParsed shows cid images in the body and lists the other attachments by their original index", () => {
  const detail = detailFromParsed(
    SUMMARY,
    parsedEmail({
      html: '<p>Oi</p><img src="cid:img1">',
      to: [{ name: " Bia ", address: "Bia@X.com" }],
      attachments: [
        part({ filename: "logo.png", mimeType: "image/png", disposition: "inline", related: true, contentId: "<img1>", content: arrayBufferOf(PNG) }),
        part({ filename: " tabela.pdf ", mimeType: "application/pdf", disposition: "attachment", content: arrayBufferOf(PDF) }),
      ],
    }),
  );
  assert.ok(detail.bodyDocument.includes(`<img src="data:image/png;base64,${PNG.toString("base64")}">`));
  assert.ok(!detail.bodyDocument.includes("cid:"));
  assert.match(detail.bodyDocument, /Content-Security-Policy/);
  // The embedded image leaves the list; the PDF keeps its place in the parsed list (1), not its place in this one (0).
  const pdfRow = { id: "1", name: "tabela.pdf", contentType: "application/pdf", size: PDF.length, downloadable: true };
  assert.deepEqual(detail, {
    ...SUMMARY, // the list row's fields come along untouched
    to: [{ name: "Bia", email: "bia@x.com" }],
    cc: [],
    bodyDocument: detail.bodyDocument,
    webLink: null,
    attachments: [pdfRow],
  });
});

check("detailFromParsed keeps an attachment's id when the images around it are shown in the body", () => {
  const png = (cid: string) => part({ mimeType: "image/png", disposition: "inline", contentId: `<${cid}>`, content: arrayBufferOf(PNG) });
  const detail = detailFromParsed(
    SUMMARY,
    parsedEmail({
      html: '<img src="cid:a"><img src="cid:b">',
      attachments: [
        part({ filename: "zero.zip", mimeType: "application/zip" }),
        png("a"),
        part({ filename: "um.pdf", mimeType: "application/pdf" }),
        png("b"),
        part({ filename: null, mimeType: "text/csv" }),
      ],
    }),
  );
  assert.deepEqual(
    detail.attachments.map((a) => [a.id, a.name]),
    [
      ["0", "zero.zip"],
      ["2", "um.pdf"],
      ["4", "anexo"],
    ],
  );
  // listedAttachments is what the download route checks an id against: same rows, same objects.
  const parsed = parsedEmail({ attachments: [part({ mimeType: "a/b" }), part({ mimeType: "c/d" })] });
  const listed = listedAttachments(parsed);
  assert.deepEqual(
    listed.map((l) => l.index),
    [0, 1],
    "without a body pointing at them nothing is hidden",
  );
  assert.equal(listed[1].attachment, parsed.attachments[1]);
  // Every listed id is one the download route accepts (three digits), however many parts the message has.
  const flood = listedAttachments(parsedEmail({ attachments: Array.from({ length: 1_005 }, () => part({ mimeType: "a/b" })) }));
  assert.equal(flood.length, 1_000);
  assert.ok(flood.every((l) => isAttachmentIndex(String(l.index))));
});

check("detailFromParsed hides an image from the list only when it showed it in the body", () => {
  const png = (over: Partial<Attachment>) => part({ mimeType: "image/png", disposition: "inline", content: arrayBufferOf(PNG), ...over });
  const detailOf = (html: string, ...attachments: Attachment[]) => detailFromParsed(SUMMARY, parsedEmail({ html, attachments }));
  const listedIds = (d: { attachments: { id: string }[] }) => d.attachments.map((a) => a.id);

  // The content id is compared without brackets and without regard to case, on either side.
  for (const [pointer, contentId] of [
    ["CID:LOGO@01", "<logo@01>"],
    ["cid:logo@01", "<Logo@01>"],
    ["cid:logo@01", "logo@01"],
  ]) {
    const shown = detailOf(`<img src="${pointer}">`, png({ contentId }));
    assert.equal(dataUris(shown.bodyDocument), 1, `${pointer} ~ ${contentId}`);
    assert.deepEqual(shown.attachments, []);
  }
  // The body doesn't point at it: it stays in the list and the body is untouched.
  const unused = detailOf('<img src="cid:outra">', png({ contentId: "<logo>", filename: "logo.png" }));
  assert.equal(dataUris(unused.bodyDocument), 0);
  assert.deepEqual(listedIds(unused), ["0"]);
  // No Content-ID, or an e-mail with no HTML at all: nothing to show.
  assert.equal(dataUris(detailOf('<img src="cid:logo">', png({})).bodyDocument), 0);
  assert.deepEqual(listedIds(detailFromParsed(SUMMARY, parsedEmail({ text: "oi", attachments: [png({ contentId: "<logo>" })] }))), ["0"]);
  // What the sender marked as an attachment is never turned into part of the body (as Graph's isInline).
  const explicit = detailOf('<img src="cid:logo">', png({ contentId: "<logo>", disposition: "attachment" }));
  assert.equal(dataUris(explicit.bodyDocument), 0);
  assert.deepEqual(listedIds(explicit), ["0"]);
  // An empty part is nothing to show.
  assert.deepEqual(listedIds(detailOf('<img src="cid:logo">', png({ contentId: "<logo>", content: new ArrayBuffer(0) }))), ["0"]);
  // Two parts with one content id: the first is shown, the other stays listed.
  const twin = detailOf('<img src="cid:logo">', png({ contentId: "<logo>" }), png({ contentId: "<LOGO>", filename: "copia.png" }));
  assert.equal(dataUris(twin.bodyDocument), 1);
  assert.deepEqual(listedIds(twin), ["1"]);
  // Only image/<token> becomes a data URI: a crafted type can't break out of the attribute.
  for (const mimeType of ['image/png"><script>', "image/png onerror=x", "text/html", "image/", "application/pdf"]) {
    const crafted = detailOf('<img src="cid:x">', png({ contentId: "<x>", mimeType }));
    assert.ok(!crafted.bodyDocument.includes(";base64,"), mimeType);
    assert.ok(!crafted.bodyDocument.includes("<script>"), mimeType);
    assert.deepEqual(listedIds(crafted), ["0"], mimeType);
  }
  // The type is written trimmed and in lower case, exactly as it was checked.
  assert.equal(dataUris(detailOf('<img src="cid:x">', png({ contentId: "<x>", mimeType: " Image/PNG " })).bodyDocument), 1);
  // The same image under a CSS url() is swapped too.
  assert.equal(dataUris(detailOf('<div style="background:url(cid:x)">', png({ contentId: "<x>" })).bodyDocument), 1);
});

check("detailFromParsed embeds at most 10 images, 1.5 MB each and 4 MB together, as the Microsoft inbox does", () => {
  const img = (n: number, size: number) =>
    part({ filename: `i${n}.png`, mimeType: "image/png", disposition: "inline", contentId: `<c${n}>`, content: new ArrayBuffer(size) });
  const html = (ids: number[]) => ids.map((n) => `<img src="cid:c${n}">`).join("");
  const listedIds = (d: { attachments: { id: string }[] }) => d.attachments.map((a) => a.id);

  // 11 images, all in the body: the first 10 are shown and the 11th stays listed (still pointing at cid:).
  const eleven = Array.from({ length: 11 }, (_, n) => img(n, 10));
  const d11 = detailFromParsed(SUMMARY, parsedEmail({ html: html(eleven.map((_, n) => n)), attachments: eleven }));
  assert.equal(dataUris(d11.bodyDocument), 10);
  assert.deepEqual(listedIds(d11), ["10"]);
  assert.ok(d11.bodyDocument.includes("cid:c10"));

  // 1.5 MB is the most one image may have.
  const each = detailFromParsed(SUMMARY, parsedEmail({ html: html([0, 1]), attachments: [img(0, 1_500_000), img(1, 1_500_001)] }));
  assert.equal(dataUris(each.bodyDocument), 1);
  assert.deepEqual(listedIds(each), ["1"]);

  // 4 MB is the most they may have together: 1.5 + 1.5 + 1.0 fits exactly, one more byte does not.
  const total = detailFromParsed(
    SUMMARY,
    parsedEmail({ html: html([0, 1, 2, 3]), attachments: [img(0, 1_500_000), img(1, 1_500_000), img(2, 1_000_000), img(3, 1)] }),
  );
  assert.equal(dataUris(total.bodyDocument), 3);
  assert.deepEqual(listedIds(total), ["3"]);
  // An image that would pass the budget stays listed, but a smaller one after it still fits.
  const skip = detailFromParsed(
    SUMMARY,
    parsedEmail({ html: html([0, 1, 2, 3]), attachments: [img(0, 1_400_000), img(1, 1_400_000), img(2, 1_400_000), img(3, 1_000)] }),
  );
  assert.equal(dataUris(skip.bodyDocument), 3);
  assert.deepEqual(listedIds(skip), ["2"]);

  // Each reference in the body counts: a crafted body can't make one image fill the page many times over.
  const repeated = detailFromParsed(SUMMARY, parsedEmail({ html: '<img src="cid:c0">'.repeat(3), attachments: [img(0, 1_400_000)] }));
  assert.equal(dataUris(repeated.bodyDocument), 0);
  assert.deepEqual(listedIds(repeated), ["0"]);
  const twice = detailFromParsed(SUMMARY, parsedEmail({ html: '<img src="cid:c0"><img src="cid:c0">', attachments: [img(0, 1_000)] }));
  assert.equal(dataUris(twice.bodyDocument), 2);
  assert.deepEqual(twice.attachments, []);
});

check("detailFromParsed reads the bytes however postal-mime was asked to hand them over", () => {
  const padded = Buffer.concat([Buffer.from("xx"), PNG, Buffer.from("yy")]);
  const forms: { label: string; content: Attachment["content"]; encoding?: Attachment["encoding"]; bytes: Buffer }[] = [
    { label: "ArrayBuffer", content: arrayBufferOf(PNG), bytes: PNG },
    { label: "Uint8Array", content: new Uint8Array(arrayBufferOf(PNG)), bytes: PNG },
    { label: "a view into a bigger buffer", content: new Uint8Array(padded.buffer, padded.byteOffset + 2, PNG.length), bytes: PNG },
    { label: "Buffer", content: PNG, bytes: PNG },
    { label: "base64 string", content: PNG.toString("base64"), encoding: "base64", bytes: PNG },
    { label: "utf8 string", content: "ação", encoding: "utf8", bytes: Buffer.from("ação") },
  ];
  for (const { label, content, encoding, bytes } of forms) {
    const detail = detailFromParsed(
      SUMMARY,
      parsedEmail({
        html: '<img src="cid:a">',
        attachments: [
          part({ mimeType: "image/png", contentId: "<a>", content, encoding }),
          part({ filename: "f.bin", mimeType: "application/octet-stream", content, encoding }),
        ],
      }),
    );
    // The image carries the same bytes whichever way they came; so does the listed file's size.
    assert.ok(detail.bodyDocument.includes(`src="data:image/png;base64,${bytes.toString("base64")}"`), label);
    assert.equal(detail.attachments[0].size, bytes.length, label);
  }
});

check("detailFromParsed shows a text-only e-mail escaped, and an HTML part that is blank gives way to the text", () => {
  const detail = detailFromParsed(SUMMARY, parsedEmail({ text: "Olá <b>mundo</b> & cia\n  recuo" }));
  assert.ok(detail.bodyDocument.includes('<div style="white-space:pre-wrap">Olá &lt;b&gt;mundo&lt;/b&gt; &amp; cia\n  recuo</div>'));
  assert.ok(!detail.bodyDocument.includes("<b>"));
  assert.equal(detail.webLink, null);
  assert.deepEqual(detail.attachments, []);
  assert.deepEqual([detail.to, detail.cc], [[], []]);
  const blank = detailFromParsed(SUMMARY, parsedEmail({ html: " \n ", text: "só texto" }));
  assert.ok(blank.bodyDocument.includes('<div style="white-space:pre-wrap">só texto</div>'));
  const none = detailFromParsed(SUMMARY, parsedEmail());
  assert.ok(none.bodyDocument.includes('<div style="white-space:pre-wrap"></div>'));
});

check("detailFromParsed flattens address groups and drops blank recipients", () => {
  const detail = detailFromParsed(
    SUMMARY,
    parsedEmail({
      text: "oi",
      to: [
        { name: "Equipe", group: [{ name: "", address: "A@x.com" }, { name: "Beto", address: "b@x.com" }] },
        { name: "Caio", address: "caio@x.com" },
        { name: "", address: "" },
      ],
      cc: [{ name: "Só nome", address: "" }],
    }),
  );
  assert.deepEqual(detail.to, [
    { name: null, email: "a@x.com" },
    { name: "Beto", email: "b@x.com" },
    { name: "Caio", email: "caio@x.com" },
  ]);
  assert.deepEqual(detail.cc, [{ name: "Só nome", email: null }]);
});

/** Every .ts/.tsx file under `dir`, recursively. A folder that isn't there throws: a scan that finds nothing must not pass. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

check("the IMAP code never deletes, moves, copies or expunges mail, closes the mailbox, rewrites flags or touches folders", () => {
  // The only writes the inbox may make are \Seen when an e-mail is opened, \Answered on a reply and the reply's copy in Sent.
  // The words count wherever they appear, comments included.
  const rules: { rule: string; re: RegExp; trips: string[] }[] = [
    {
      rule: "delete, move or copy e-mail, expunge, or change folders",
      re: /\b(messageDelete|messageMove|messageCopy|expunge|mailboxDelete|mailboxRename|mailboxCreate)\b/,
      trips: ["await c.messageDelete(uid)", "c.messageMove(1, 'Trash')", "c.messageCopy(1, 'a')", "client.expunge()", "x.mailboxDelete('a')", "x.mailboxRename('a', 'b')", "x.mailboxCreate('a')"],
    },
    {
      // imapflow's mailboxClose sends CLOSE, which removes for good whatever is flagged \Deleted.
      rule: "close the mailbox",
      re: /\bmailboxClose\b/,
      trips: ["await client.mailboxClose()"],
    },
    {
      rule: "replace or remove flags",
      re: /\b(messageFlagsSet|messageFlagsRemove|setFlagColor)\b/,
      trips: ["client.messageFlagsSet(uid, [])", "client.messageFlagsRemove(uid, ['x'])", "client.setFlagColor(uid, 'red')"],
    },
    {
      rule: "name the \\Deleted flag",
      re: /\\+deleted\b/i,
      trips: [String.raw`client.messageFlagsAdd(uid, ["\\Deleted"])`, String.raw`flags.has("\Deleted")`, String.raw`["\\deleted"]`, String.raw`["\\DELETED"]`],
    },
    {
      rule: "name the Deleted flag",
      re: /\bDeleted\b/,
      trips: ['const FLAG = "Deleted"', "// never flag it Deleted"],
    },
  ];
  // The patterns themselves, so a typo in one can't turn the scan below into a silent pass.
  for (const { rule, re, trips } of rules) {
    for (const sample of trips) assert.ok(re.test(sample), `${rule}: ${sample}`);
  }
  const allowed = [
    String.raw`client.messageFlagsAdd(uid, ["\\Seen"])`,
    String.raw`client.messageFlagsAdd(uid, ["\\Answered"])`,
    String.raw`await client.append(path, mime, ["\\Seen"])`,
    "const lock = await client.getMailboxLock('INBOX')",
    "lock.release()",
    "await client.logout()",
  ];
  for (const sample of allowed) {
    for (const { rule, re } of rules) assert.ok(!re.test(sample), `${rule} wrongly trips on ${sample}`);
  }

  const dir = join(__dirname, "..", "src", "lib", "email-broadcast", "imap");
  const files = sourcesUnder(dir);
  // Not a silent pass: the modules this folder is known to hold have to be among the files scanned.
  const scanned = files.map((file) => relative(dir, file));
  for (const required of ["core.ts", "parse.ts"]) {
    assert.ok(scanned.includes(required), `${required} was not scanned (scanned: ${scanned.join(", ") || "nothing"})`);
  }
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const { rule, re } of rules) assert.ok(!re.test(text), `${relative(dir, file)} must not ${rule}`);
  }
});

async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main() {
  await checkAsync("xlsxSheets + readSheets read every sheet, link targets and rich text of a real .xlsx", async () => {
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

    const r = readSheets(await xlsxSheets(ExcelJS, data));
    assert.deepEqual(r.emails, ["ana@x.com", "bia@x.com", "caio@x.com", "dani@x.com", "edu@x.com"]);
    // "Evento SP" has the Nome/E-mail header row; "Evento RJ" has none, so Edu comes without a name.
    assert.deepEqual(
      r.people?.map((p) => p.name),
      ["Ana", "Bia", "Caio", "Dani", ""],
    );
    assert.equal(r.duplicates, 0);
    assert.equal(r.invalid, 0);
  });

  await checkAsync("xlsxSheets keeps each cell in its own column when a row has empty cells", async () => {
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet("Prospecção");
    s.addRow(["email", "tipo_email", "nome", "sobrenome", "cargo", "empresa", "telefone", "ultima_interacao"]);
    s.addRow(["wesley.rodrigosilva@hotmail.com", "pessoal", "Wesley", "Rodrigo", "", "Toyota do Brasil", "", new Date(Date.UTC(2026, 9, 16))]);
    s.addRow(["eallan@suzano.com.br", "corporativo", "Edson", "Allan Franco", null, "Suzano — unidade Limeira/SP"]);
    const data = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

    const r = readSheets(await xlsxSheets(ExcelJS, data));
    assert.deepEqual(r.emails, ["wesley.rodrigosilva@hotmail.com", "eallan@suzano.com.br"]);
    assert.deepEqual(r.people, [
      { name: "Wesley Rodrigo", company: "Toyota do Brasil" },
      { name: "Edson Allan Franco", company: "Suzano — unidade Limeira/SP" },
    ]);
  });

  await checkAsync("xlsxSheets rejects a file that isn't an .xlsx", async () => {
    await assert.rejects(xlsxSheets(ExcelJS, new TextEncoder().encode("ana@x.com").buffer as ArrayBuffer));
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

  // The IMAP checks above build `Email` objects by hand; these read what postal-mime really returns.
  const mixed = (parts: string[]): string =>
    [
      "From: =?UTF-8?Q?Jo=C3=A3o?= <Joao@Exemplo.com>",
      "To: Equipe: a@x.com, b@x.com;, Maria <maria@x.com>",
      "Cc: Caio <Caio@x.com>",
      "Subject: =?UTF-8?Q?Promo=C3=A7=C3=A3o?=",
      "Message-ID: <abc@x.com>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="MIXED"',
      "",
      ...parts,
      "--MIXED--",
      "",
    ].join("\r\n");
  const relatedHtml = [
    "--MIXED",
    'Content-Type: multipart/related; boundary="REL"',
    "",
    "--REL",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<p>Oi <img src="cid:img1"></p>',
    "--REL",
    "Content-Type: image/png; name=logo.png",
    "Content-Transfer-Encoding: base64",
    "Content-ID: <img1>",
    "Content-Disposition: inline; filename=logo.png",
    "",
    PNG.toString("base64"),
    "--REL--",
  ];
  const pdfAttachment = [
    "--MIXED",
    'Content-Type: application/pdf; name="tabela.pdf"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="tabela.pdf"',
    "",
    PDF.toString("base64"),
  ];

  await checkAsync("detailFromParsed reads a real multipart e-mail: cid image shown, PDF listed, recipients flattened", async () => {
    const mime = mixed([...relatedHtml, ...pdfAttachment]);
    // Both ways postal-mime can hand the bytes over (its default and attachmentEncoding "base64").
    for (const options of [undefined, { attachmentEncoding: "base64" as const }]) {
      const parsed = await PostalMime.parse(mime, options);
      const detail = detailFromParsed(SUMMARY, parsed);
      assert.ok(detail.bodyDocument.includes(`<img src="data:image/png;base64,${PNG.toString("base64")}">`), JSON.stringify(options));
      assert.ok(!detail.bodyDocument.includes("cid:"));
      assert.deepEqual(detail.attachments, [{ id: "1", name: "tabela.pdf", contentType: "application/pdf", size: PDF.length, downloadable: true }]);
      assert.deepEqual(
        listedAttachments(parsed).map((l) => l.index),
        [1],
      );
      assert.deepEqual(detail.to, [
        { name: null, email: "a@x.com" },
        { name: null, email: "b@x.com" },
        { name: "Maria", email: "maria@x.com" },
      ]);
      assert.deepEqual(detail.cc, [{ name: "Caio", email: "caio@x.com" }]);
      assert.equal(detail.webLink, null);
    }
  });

  await checkAsync("detailFromParsed lists a real inline image that the HTML doesn't point at", async () => {
    // Same e-mail, but the HTML no longer points at the image: it is an attachment like any other.
    const noPointer = relatedHtml.map((line) => line.replace('<img src="cid:img1">', ""));
    const parsed = await PostalMime.parse(mixed([...noPointer, ...pdfAttachment]));
    const detail = detailFromParsed(SUMMARY, parsed);
    assert.equal(dataUris(detail.bodyDocument), 0);
    assert.deepEqual(
      detail.attachments.map((a) => [a.id, a.name]),
      [
        ["0", "logo.png"],
        ["1", "tabela.pdf"],
      ],
    );
  });

  await checkAsync("detailFromParsed reads a plain-text ISO-8859-1 e-mail as text, accents intact", async () => {
    const latin1 = [
      "From: cliente@exemplo.com.br",
      "Subject: =?ISO-8859-1?Q?Promo=E7=E3o_de_outubro?=",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=iso-8859-1",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Promo=E7=E3o  de outubro: <10% de desconto> & mais",
      "",
    ].join("\r\n");
    const parsed = await PostalMime.parse(latin1);
    assert.equal(parsed.subject, "Promoção de outubro");
    assert.equal(parsed.html, undefined, "a text-only message has no html part, so it takes the text path");
    const detail = detailFromParsed(SUMMARY, parsed);
    assert.ok(detail.bodyDocument.includes('<div style="white-space:pre-wrap">Promoção  de outubro: &lt;10% de desconto&gt; &amp; mais'));
    assert.deepEqual(detail.attachments, []);
  });

  console.log(`\n✅ email-broadcast: ${passed} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
