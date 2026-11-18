/**
 * Check of the "already exists" lookup behind the quick add of company and
 * contact in "Nova oportunidade" (`findCompanyMatches` / `findContactMatches`
 * in src/lib/queries/duplicates.ts). They read with SQL where the organization
 * is written by hand, so this check proves, against the local Postgres, that a
 * match is found however the CNPJ/phone was typed AND that another company's
 * records never come back. Run with `npm run check:crm-matches` (Postgres from
 * Docker up). Creates two organizations and deletes everything it created,
 * even on failure. Names, CNPJs, phones and e-mails are made up.
 */
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { findCompanyMatches, findContactMatches } from "../src/lib/queries/duplicates";

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const orgA = await prisma.organization.create({ data: { name: `MATCH-A-${stamp}`, slug: `match-a-${stamp}` } });
  const orgB = await prisma.organization.create({ data: { name: `MATCH-B-${stamp}`, slug: `match-b-${stamp}` } });
  const orgs = [orgA.id, orgB.id];
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
