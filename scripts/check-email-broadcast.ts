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

console.log(`\n✅ email-broadcast: ${passed} checks passed.`);
