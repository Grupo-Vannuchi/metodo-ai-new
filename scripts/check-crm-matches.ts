/**
 * Check of the "already exists" lookup behind the quick add of company and
 * contact in "Nova oportunidade" (`findCompanyMatches` / `findContactMatches`
 * in src/lib/queries/duplicates.ts). They read with SQL where the organization
 * is written by hand, so this check proves, against the local Postgres, that a
 * match is found however the CNPJ/phone was typed AND that another company's
 * records never come back. It also covers the groups of the "Mesclar
 * duplicados" tool (`findCompanyDuplicates` / `findContactDuplicates`), which
 * until 18/11/2026 only grouped phones/CNPJs typed exactly alike. Run with
 * `npm run check:crm-matches` (Postgres from Docker up). Creates three
 * organizations and deletes everything it created, even on failure. Names,
 * CNPJs, phones and e-mails are made up.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  findCompanyDuplicates,
  findCompanyMatches,
  findContactDuplicates,
  findContactMatches,
} from "../src/lib/queries/duplicates";
import { resolveContactId } from "../src/lib/whatsapp/ingest";
import { assertLocalDatabase } from "./lib/local-db";

assertLocalDatabase("check:crm-matches", process.env.DATABASE_URL);

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** Every .ts/.tsx under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

async function main(): Promise<void> {
  await check("no SQL in src/ cleans digits with a backslash-D (it reaches Postgres as 'D')", async () => {
    const offenders = sourceFiles(join(__dirname, "..", "src")).filter((f) =>
      /regexp_replace\([^)]*'\\D'/.test(readFileSync(f, "utf8")),
    );
    assert.deepEqual(offenders, [], `use '[^0-9]' instead of '\\D' in: ${offenders.join(", ")}`);
  });

  const stamp = Date.now();
  const orgA = await prisma.organization.create({ data: { name: `MATCH-A-${stamp}`, slug: `match-a-${stamp}` } });
  const orgB = await prisma.organization.create({ data: { name: `MATCH-B-${stamp}`, slug: `match-b-${stamp}` } });
  // Org C holds the "Mesclar duplicados" pairs, so they don't disturb A's matches.
  const orgC = await prisma.organization.create({ data: { name: `MATCH-C-${stamp}`, slug: `match-c-${stamp}` } });
  const orgs = [orgA.id, orgB.id, orgC.id];
  try {
    const acme = await prisma.company.create({
      data: { organizationId: orgA.id, name: "Acme Engenharia", cnpj: "12.345.678/0001-90" },
    });
    await prisma.company.create({ data: { organizationId: orgA.id, name: "Outra Ltda", cnpj: null } });
    // Same CNPJ, name and phone in org B: must never leak into org A's results.
    const acmeB = await prisma.company.create({
      data: { organizationId: orgB.id, name: "Acme Engenharia", cnpj: "12345678000190" },
    });
    const maria = await prisma.contact.create({
      data: { organizationId: orgA.id, name: "Maria Teste", phone: "+55 (13) 99000-0001", email: "Maria@Exemplo.com " },
    });
    const mariaB = await prisma.contact.create({
      data: { organizationId: orgB.id, name: "Maria Teste", phone: "13990000001", email: "maria@exemplo.com" },
    });
    const bIds = new Set([acmeB.id, mariaB.id]);

    await check("company: same CNPJ typed with digits only is found, with the reason", async () => {
      const r = await findCompanyMatches(orgA.id, { name: "Nome diferente", cnpj: "12345678000190" });
      assert.deepEqual(r.map((m) => [m.id, m.reason]), [[acme.id, "cnpj"]]);
    });

    await check("company: same name with other case and spaces is found", async () => {
      const r = await findCompanyMatches(orgA.id, { name: "  acme ENGENHARIA " });
      assert.deepEqual(r.map((m) => [m.id, m.reason]), [[acme.id, "name"]]);
    });

    await check("company: CNPJ and name of the same record count once, as CNPJ", async () => {
      const r = await findCompanyMatches(orgA.id, { name: "Acme Engenharia", cnpj: "12.345.678/0001-90" });
      assert.deepEqual(r.map((m) => [m.id, m.reason]), [[acme.id, "cnpj"]]);
    });

    await check("company: nothing similar returns an empty list", async () => {
      assert.deepEqual(await findCompanyMatches(orgA.id, { name: "Empresa Nova", cnpj: "99.999.999/0001-99" }), []);
      assert.deepEqual(await findCompanyMatches(orgA.id, { name: "", cnpj: "123" }), []);
    });

    await check("contact: same phone in another format is found (last 11 digits)", async () => {
      const r = await findContactMatches(orgA.id, { phone: "13 99000-0001" });
      assert.deepEqual(r.map((m) => [m.id, m.reason]), [[maria.id, "phone"]]);
    });

    await check("contact: same e-mail with other case and spaces is found", async () => {
      const r = await findContactMatches(orgA.id, { email: " MARIA@exemplo.COM" });
      assert.deepEqual(r.map((m) => [m.id, m.reason]), [[maria.id, "email"]]);
    });

    await check("contact: a short phone or an empty input never matches", async () => {
      assert.deepEqual(await findContactMatches(orgA.id, { phone: "0001" }), []);
      assert.deepEqual(await findContactMatches(orgA.id, {}), []);
    });

    await check("isolation: org B's twins never come back to org A, and vice versa", async () => {
      const all = [
        ...(await findCompanyMatches(orgA.id, { name: "Acme Engenharia", cnpj: "12345678000190" })),
        ...(await findContactMatches(orgA.id, { phone: "13990000001", email: "maria@exemplo.com" })),
      ];
      assert.ok(all.length > 0);
      assert.ok(all.every((m) => !bIds.has(m.id)), "a record from org B leaked into org A");
      const fromB = await findCompanyMatches(orgB.id, { name: "Acme Engenharia", cnpj: "12345678000190" });
      assert.deepEqual(fromB.map((m) => m.id), [acmeB.id]);
    });

    // "Mesclar duplicados" (findCompanyDuplicates / findContactDuplicates).
    const beta1 = await prisma.company.create({ data: { organizationId: orgC.id, name: "Beta Ltda", cnpj: "98.765.432/0001-10" } });
    const beta2 = await prisma.company.create({ data: { organizationId: orgC.id, name: "Beta Comércio", cnpj: "98765432000110" } });
    const joao1 = await prisma.contact.create({ data: { organizationId: orgC.id, name: "João A", phone: "+55 (11) 98888-0002" } });
    const joao2 = await prisma.contact.create({ data: { organizationId: orgC.id, name: "João B", phone: "11988880002" } });
    // Fewer than 8 digits once cleaned: never a duplicate, whatever the format.
    await prisma.contact.create({ data: { organizationId: orgC.id, name: "Curto 1", phone: "12-34-56" } });
    await prisma.contact.create({ data: { organizationId: orgC.id, name: "Curto 2", phone: "123456" } });
    const sameIds = (ids: string[], expected: string[]) => assert.deepEqual([...ids].sort(), [...expected].sort());

    await check("merge tool: the same CNPJ in two formats is one group", async () => {
      const groups = await findCompanyDuplicates(orgC.id);
      const cnpj = groups.filter((g) => g.reason === "cnpj");
      assert.equal(cnpj.length, 1);
      sameIds(cnpj[0].records.map((r) => r.id), [beta1.id, beta2.id]);
    });

    await check("merge tool: the same phone in two formats is one group; short phones never group", async () => {
      const groups = await findContactDuplicates(orgC.id);
      assert.equal(groups.length, 1);
      assert.equal(groups[0].reason, "phone");
      sameIds(groups[0].records.map((r) => r.id), [joao1.id, joao2.id]);
    });

    await check("WhatsApp: a message from a number already in the CRM (any format) links to it, no new contact", async () => {
      const ana = await prisma.contact.create({ data: { organizationId: orgC.id, name: "Ana CRM", phone: "+55 (11) 97777-0003" } });
      // Same number in org B: must not be the one picked for org C.
      await prisma.contact.create({ data: { organizationId: orgB.id, name: "Ana B", phone: "11977770003" } });
      const before = await prisma.contact.count({ where: { organizationId: orgC.id } });
      const id = await resolveContactId(orgC.id, "5511977770003@s.whatsapp.net", "Ana do WhatsApp");
      assert.equal(id, ana.id);
      assert.equal(await prisma.contact.count({ where: { organizationId: orgC.id } }), before);
    });

    await check("WhatsApp: the contact it creates for a new number is found again on the next message", async () => {
      const first = await resolveContactId(orgC.id, "5511966660004@s.whatsapp.net", "Novo");
      const again = await resolveContactId(orgC.id, "5511966660004@s.whatsapp.net", "Novo");
      assert.ok(first);
      assert.equal(again, first);
    });

    await check("merge tool: a twin in another organization is never grouped", async () => {
      // Org A's Acme and org B's Acme share CNPJ and name; each org alone has no pair.
      assert.deepEqual(await findCompanyDuplicates(orgA.id), []);
      assert.deepEqual(await findContactDuplicates(orgA.id), []);
    });
  } finally {
    await prisma.contact.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.company.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  }
  console.log(`\ncheck:crm-matches — ${passed} checks passed`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
