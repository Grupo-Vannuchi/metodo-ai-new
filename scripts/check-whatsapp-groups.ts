/**
 * Self-check for the pure rules of "Adicionar aos contatos" with WhatsApp
 * groups (no DB, no network, no env). Run with `npm run check:groups`; exits
 * non-zero on the first failure.
 */
import assert from "node:assert/strict";
import {
  parseContactNames,
  parseGroupParticipants,
  withContactNames,
} from "../src/lib/integrations/evolution-groups";
import { normalizeGroupNumber, phoneForContact, planGroupImport } from "../src/lib/whatsapp/group-import";

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

check("parseGroupParticipants keeps the name Evolution sends, not its digits-only fallback", () => {
  const parts = parseGroupParticipants([
    { id: "123456789012345@lid", phoneNumber: "5513991886920@s.whatsapp.net", name: "  Maria   Souza " },
    { id: "5511987654321@s.whatsapp.net", name: "5511987654321" },
    { id: "5511912345678@s.whatsapp.net", name: "123456789012345" },
    { id: "5511955554444@s.whatsapp.net", notify: "Zé 🚀" },
    { id: "5511933332222@s.whatsapp.net", name: "   " },
    { id: "5511922221111@s.whatsapp.net", name: "+55 (11) 92222-1111" },
  ]);
  assert.deepEqual(parts, [
    { number: "5513991886920", admin: false, name: "Maria Souza" },
    { number: "5511987654321", admin: false },
    { number: "5511912345678", admin: false },
    { number: "5511955554444", admin: false, name: "Zé 🚀" },
    { number: "5511933332222", admin: false },
    { number: "5511922221111", admin: false },
  ]);
});

check("parseContactNames maps phone JIDs to names and skips LIDs, groups and nameless contacts", () => {
  const names = parseContactNames([
    { remoteJid: "5513991886920@s.whatsapp.net", pushName: "Maria" },
    { remoteJid: "5513991886920@s.whatsapp.net", pushName: "Maria (outra)" },
    { remoteJid: "123456789012345@lid", pushName: "Só LID" },
    { remoteJid: "120363000000000000@g.us", pushName: "Grupo" },
    { remoteJid: "5511987654321@s.whatsapp.net", pushName: "5511987654321" },
    { remoteJid: "5511912345678@s.whatsapp.net", pushName: null },
    { remoteJid: "5511955554444@s.whatsapp.net", pushName: "João" },
    null,
  ]);
  assert.deepEqual([...names], [
    ["5513991886920", "Maria"],
    ["5511955554444", "João"],
  ]);
});

check("withContactNames fills only the members still without a name", () => {
  const names = new Map([
    ["5513991886920", "Maria"],
    ["5511987654321", "Contato salvo"],
  ]);
  assert.deepEqual(
    withContactNames(
      [
        { number: "5513991886920", admin: false },
        { number: "5511987654321", admin: true, name: "Nome do grupo" },
        { number: "5511912345678", admin: false },
      ],
      names,
    ),
    [
      { number: "5513991886920", admin: false, name: "Maria" },
      { number: "5511987654321", admin: true, name: "Nome do grupo" },
      { number: "5511912345678", admin: false },
    ],
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

check("planGroupImport names contacts after the member, or the phone when there is no name", () => {
  const existing = new Set(["13991886920"]);
  const plan = planGroupImport(
    [
      { number: "5513991886920", name: "Já no CRM" },
      { number: "5511987654321", name: "Maria Souza" },
      { number: "551187654322" },
      { number: "5511987654321", name: "Maria de novo" },
      { number: "447911123456" },
    ],
    existing,
  );
  assert.deepEqual(plan.create, [
    { name: "Maria Souza", phone: "(11) 98765-4321", key: "11987654321" },
    { name: "(11) 98765-4322", phone: "(11) 98765-4322", key: "11987654322" },
    { name: "+447911123456", phone: "+447911123456", key: "47911123456" },
  ]);
  assert.equal(plan.skipped, 2);
});

check("planGroupImport on a second run of the same group creates nothing", () => {
  const members = [{ number: "5511987654321", name: "Maria" }, { number: "5511912345678" }];
  const first = planGroupImport(members, new Set());
  const known = new Set(first.create.map((c) => c.key));
  assert.deepEqual(planGroupImport(members, known), { create: [], skipped: 2 });
});

console.log(`\n✅ whatsapp-groups: ${passed} checks passed.`);
