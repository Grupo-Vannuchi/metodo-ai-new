/**
 * Self-check for the pure rules of "Adicionar aos contatos" with WhatsApp
 * groups (no DB, no network, no env). Run with `npm run check:groups`; exits
 * non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { parseGroupParticipants } from "../src/lib/integrations/evolution-groups";
import {
  CONTACT_NAME_PREFIX,
  lastContactNumber,
  normalizeGroupNumber,
  phoneForContact,
  planGroupImport,
} from "../src/lib/whatsapp/group-import";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("parseGroupParticipants takes the number from phoneNumber when the id is a LID", () => {
  const parts = parseGroupParticipants([
    { id: "123456789012345@lid", phoneNumber: "5513991886920@s.whatsapp.net", admin: null },
    { id: "998877665544332@lid", phoneNumber: "551391886921@s.whatsapp.net", admin: "admin" },
    { id: "5511987654321@s.whatsapp.net", admin: "superadmin" },
  ]);
  assert.deepEqual(parts, [
    { number: "5513991886920", admin: false },
    { number: "551391886921", admin: true },
    { number: "5511987654321", admin: true },
  ]);
});

check("parseGroupParticipants drops members without a real number", () => {
  assert.deepEqual(
    parseGroupParticipants([
      { id: "123456789012345@lid" },
      { id: "123456789012345@lid", phoneNumber: "" },
      { id: "abc@s.whatsapp.net" },
      { id: "12345@s.whatsapp.net" },
      null,
      "x",
    ]),
    [],
  );
});

check("normalizeGroupNumber adds the 9 to old 12-digit BR mobiles and keeps the rest", () => {
  assert.equal(normalizeGroupNumber("551391886920"), "5513991886920");
  assert.equal(normalizeGroupNumber("5513991886920"), "5513991886920");
  assert.equal(normalizeGroupNumber("551332221234"), "551332221234");
  assert.equal(normalizeGroupNumber("447911123456"), "447911123456");
  assert.equal(normalizeGroupNumber("12345"), null);
  assert.equal(normalizeGroupNumber("1234567890123456"), null);
});

check("phoneForContact formats BR numbers and keeps others international", () => {
  assert.equal(phoneForContact("5513991886920"), "(13) 99188-6920");
  assert.equal(phoneForContact("551332221234"), "(13) 3222-1234");
  assert.equal(phoneForContact("447911123456"), "+447911123456");
});

check("lastContactNumber reads only names shaped like 'Contato #N'", () => {
  assert.equal(CONTACT_NAME_PREFIX, "Contato #");
  assert.equal(lastContactNumber([]), 0);
  assert.equal(lastContactNumber(["Contato #3", "Contato #12", "Maria", "Contato #x", "Contato #7 (vip)"]), 12);
});

check("planGroupImport numbers new contacts after the last one and skips known numbers", () => {
  const existing = new Set(["13991886920"]);
  const plan = planGroupImport(
    ["5513991886920", "5511987654321", "551187654322", "5511987654321", "447911123456"],
    existing,
    7,
  );
  assert.deepEqual(plan.create, [
    { name: "Contato #8", phone: "(11) 98765-4321", key: "11987654321" },
    { name: "Contato #9", phone: "(11) 98765-4322", key: "11987654322" },
    { name: "Contato #10", phone: "+447911123456", key: "47911123456" },
  ]);
  assert.equal(plan.skipped, 2);
});

check("planGroupImport on a second run of the same group creates nothing", () => {
  const first = planGroupImport(["5511987654321", "5511912345678"], new Set(), 0);
  const known = new Set(first.create.map((c) => c.key));
  const second = planGroupImport(["5511987654321", "5511912345678"], known, 2);
  assert.deepEqual(second, { create: [], skipped: 2 });
});

console.log(`\n✅ whatsapp-groups: ${passed} checks passed.`);
