/**
 * Database check of the duplicate merge ("Mesclar duplicados", src/lib/crm/merge-records.ts): what only the
 * real Postgres proves. Runs `mergeContactRecords` and `mergeCompanyRecords` through `tenantDb`, like the
 * server action does, and reads the result back with the raw client (no org filter), so a row written into
 * or taken from the wrong company shows up.
 *
 * Covers: the opt-out (LGPD) that must survive the merge; the repoint of the official WhatsApp conversation,
 * the task, the service ticket, the client asset, the imported lead and the contacts of a company; one
 * campaign recipient and one pin per user left when two losers had one each; blank fields filled from the
 * losers; and the isolation — an id of another company is never touched, and a primary of another company
 * is refused.
 *
 * Creates two companies (`MERGE-DB-A/B-<stamp>`) and two users (`merge-db-*@test.local`) and ALWAYS deletes
 * what it created, even when a check fails. A run that is killed leaves them behind: delete by hand the
 * organizations whose `slug` starts with `merge-db-` and the users whose e-mail starts with `merge-db-`.
 *
 * Run: npm run check:merge:db   (needs the local Postgres up and a valid .env)
 * Exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertLocalDatabase } from "./lib/local-db";
import { tenantDb } from "@/lib/tenant-db";
import { mergeCompanyRecords, mergeContactRecords } from "@/lib/crm/merge-records";

const connectionString = process.env.DATABASE_URL;
assertLocalDatabase("check:merge:db", connectionString);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const stamp = Date.now();
const created = { orgs: [] as string[], users: [] as string[] };

type Case = { name: string; fn: () => Promise<void> };
const cases: Case[] = [];
function check(name: string, fn: () => Promise<void>) {
  cases.push({ name, fn });
}

const ctx = {} as { orgA: string; orgB: string; u1: string; u2: string; cloudNumber: string; job: string };
let seq = 0;

async function makeContact(organizationId: string, data: { phone?: string; email?: string; optedOut?: boolean; tags?: string[] } = {}) {
  const c = await prisma.contact.create({ data: { organizationId, name: `c${++seq}-${stamp}`, ...data } });
  return c.id;
}

async function makeCompany(organizationId: string, data: { cnpj?: string; phone?: string } = {}) {
  const c = await prisma.company.create({ data: { organizationId, name: `e${++seq}-${stamp}`, ...data } });
  return c.id;
}

async function exists(model: "contact" | "company", id: string) {
  const row =
    model === "contact"
      ? await prisma.contact.findFirst({ where: { id }, select: { id: true } })
      : await prisma.company.findFirst({ where: { id }, select: { id: true } });
  return row !== null;
}

// ── Contacts ─────────────────────────────────────────────────────────────────

check("contact: the opt-out of a loser survives the merge (LGPD)", async () => {
  const primary = await makeContact(ctx.orgA);
  const loser = await makeContact(ctx.orgA, { optedOut: true });
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), primary, [loser]), "ok");
  const row = await prisma.contact.findFirstOrThrow({ where: { id: primary } });
  assert.equal(row.optedOut, true);
  assert.equal(await exists("contact", loser), false);
});

check("contact: nobody opted out stays not opted out", async () => {
  const primary = await makeContact(ctx.orgA);
  const loser = await makeContact(ctx.orgA);
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), primary, [loser]), "ok");
  const row = await prisma.contact.findFirstOrThrow({ where: { id: primary } });
  assert.equal(row.optedOut, false);
});

check("contact: blank fields come from the loser, the primary's own win, tags add up", async () => {
  const primary = await makeContact(ctx.orgA, { email: `p${stamp}@test.local`, tags: ["a"] });
  const loser = await makeContact(ctx.orgA, { email: `l${stamp}@test.local`, phone: "(00) 00000-0001", tags: ["b"] });
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), primary, [loser]), "ok");
  const row = await prisma.contact.findFirstOrThrow({ where: { id: primary } });
  assert.equal(row.email, `p${stamp}@test.local`);
  assert.equal(row.phone, "(00) 00000-0001");
  assert.deepEqual([...row.tags].sort(), ["a", "b"]);
});

check("contact: the official WhatsApp conversation and the task move to the primary", async () => {
  const primary = await makeContact(ctx.orgA);
  const loser = await makeContact(ctx.orgA);
  const convo = await prisma.whatsappCloudConversation.create({
    data: { organizationId: ctx.orgA, numberId: ctx.cloudNumber, waId: `merge${++seq}${stamp}`, contactId: loser },
  });
  const task = await prisma.task.create({ data: { organizationId: ctx.orgA, title: `t-${stamp}`, contactId: loser } });
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), primary, [loser]), "ok");
  assert.equal((await prisma.whatsappCloudConversation.findFirstOrThrow({ where: { id: convo.id } })).contactId, primary);
  assert.equal((await prisma.task.findFirstOrThrow({ where: { id: task.id } })).contactId, primary);
});

check("contact: two losers in the same campaign leave one recipient (used to break the merge)", async () => {
  const primary = await makeContact(ctx.orgA);
  const l1 = await makeContact(ctx.orgA);
  const l2 = await makeContact(ctx.orgA);
  const camp = await prisma.campaign.create({
    data: { organizationId: ctx.orgA, name: `camp-${++seq}-${stamp}`, channel: "EMAIL", createdById: ctx.u1 },
  });
  const both = await prisma.campaign.create({
    data: { organizationId: ctx.orgA, name: `camp-${++seq}-${stamp}`, channel: "EMAIL", createdById: ctx.u1 },
  });
  await prisma.campaignRecipient.createMany({
    data: [
      { organizationId: ctx.orgA, campaignId: camp.id, contactId: l1 },
      { organizationId: ctx.orgA, campaignId: camp.id, contactId: l2 },
      { organizationId: ctx.orgA, campaignId: both.id, contactId: primary },
      { organizationId: ctx.orgA, campaignId: both.id, contactId: l1 },
    ],
  });
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), primary, [l1, l2]), "ok");
  const rows = await prisma.campaignRecipient.findMany({ where: { campaignId: { in: [camp.id, both.id] } } });
  assert.deepEqual(
    rows.map((r) => `${r.campaignId === camp.id ? "camp" : "both"}:${r.contactId === primary ? "primary" : "other"}`).sort(),
    ["both:primary", "camp:primary"],
  );
});

check("contact: pins end as one per user, on the primary", async () => {
  const primary = await makeContact(ctx.orgA);
  const l1 = await makeContact(ctx.orgA);
  const l2 = await makeContact(ctx.orgA);
  await prisma.pinnedItem.createMany({
    data: [
      { organizationId: ctx.orgA, userId: ctx.u1, entityType: "CONTACT", entityId: primary },
      { organizationId: ctx.orgA, userId: ctx.u1, entityType: "CONTACT", entityId: l1 },
      { organizationId: ctx.orgA, userId: ctx.u2, entityType: "CONTACT", entityId: l1 },
      { organizationId: ctx.orgA, userId: ctx.u2, entityType: "CONTACT", entityId: l2 },
    ],
  });
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), primary, [l1, l2]), "ok");
  const pins = await prisma.pinnedItem.findMany({ where: { entityId: { in: [primary, l1, l2] } } });
  assert.deepEqual(
    pins.map((p) => `${p.userId === ctx.u1 ? "u1" : "u2"}:${p.entityId === primary ? "primary" : "loser"}`).sort(),
    ["u1:primary", "u2:primary"],
  );
});

check("contact: an id of another company is ignored and left untouched", async () => {
  const primary = await makeContact(ctx.orgA);
  const loser = await makeContact(ctx.orgA);
  const foreign = await makeContact(ctx.orgB, { optedOut: true });
  const foreignTask = await prisma.task.create({ data: { organizationId: ctx.orgB, title: `t-${stamp}`, contactId: foreign } });
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), primary, [loser, foreign]), "ok");
  assert.equal(await exists("contact", foreign), true);
  assert.equal((await prisma.task.findFirstOrThrow({ where: { id: foreignTask.id } })).contactId, foreign);
  // The foreign contact's opt-out did not leak into company A's contact.
  assert.equal((await prisma.contact.findFirstOrThrow({ where: { id: primary } })).optedOut, false);
  // Only foreign losers: nothing to merge.
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), primary, [foreign]), "invalid");
});

check("contact: a primary of another company is refused and nothing changes", async () => {
  const foreignPrimary = await makeContact(ctx.orgB);
  const loser = await makeContact(ctx.orgA);
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), foreignPrimary, [loser]), "invalid");
  assert.equal(await exists("contact", loser), true);
});

check("contact: malformed input is refused", async () => {
  const primary = await makeContact(ctx.orgA);
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), primary, "not-a-list"), "invalid");
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), primary, [primary]), "invalid");
  assert.equal(await mergeContactRecords(tenantDb(ctx.orgA), 42, ["x"]), "invalid");
});

// ── Companies ────────────────────────────────────────────────────────────────

check("company: contact, service ticket, client asset, imported lead and pins move to the primary", async () => {
  const primary = await makeCompany(ctx.orgA);
  const loser = await makeCompany(ctx.orgA, { cnpj: "00.000.000/0001-00" });
  const contact = await makeContact(ctx.orgA);
  await prisma.contact.updateMany({ where: { id: contact }, data: { companyId: loser } });
  const ticket = await prisma.serviceTicket.create({
    data: { organizationId: ctx.orgA, equipment: `eq-${stamp}`, receivedAt: new Date(), companyId: loser },
  });
  const asset = await prisma.asset.create({ data: { organizationId: ctx.orgA, name: `a-${stamp}`, ownerCompanyId: loser } });
  const lead = await prisma.extractedLead.create({
    data: { organizationId: ctx.orgA, jobId: ctx.job, importedCompanyId: loser },
  });
  await prisma.pinnedItem.create({
    data: { organizationId: ctx.orgA, userId: ctx.u1, entityType: "COMPANY", entityId: loser },
  });

  assert.equal(await mergeCompanyRecords(tenantDb(ctx.orgA), primary, [loser]), "ok");
  assert.equal(await exists("company", loser), false);
  assert.equal((await prisma.contact.findFirstOrThrow({ where: { id: contact } })).companyId, primary);
  assert.equal((await prisma.serviceTicket.findFirstOrThrow({ where: { id: ticket.id } })).companyId, primary);
  assert.equal((await prisma.asset.findFirstOrThrow({ where: { id: asset.id } })).ownerCompanyId, primary);
  assert.equal((await prisma.extractedLead.findFirstOrThrow({ where: { id: lead.id } })).importedCompanyId, primary);
  const pins = await prisma.pinnedItem.findMany({ where: { entityType: "COMPANY", entityId: { in: [primary, loser] } } });
  assert.deepEqual(pins.map((p) => p.entityId), [primary]);
  assert.equal((await prisma.company.findFirstOrThrow({ where: { id: primary } })).cnpj, "00.000.000/0001-00");
});

check("company: an id of another company is ignored, and a foreign primary is refused", async () => {
  const primary = await makeCompany(ctx.orgA);
  const loser = await makeCompany(ctx.orgA);
  const foreign = await makeCompany(ctx.orgB);
  const foreignTicket = await prisma.serviceTicket.create({
    data: { organizationId: ctx.orgB, equipment: `eq-${stamp}`, receivedAt: new Date(), companyId: foreign },
  });
  assert.equal(await mergeCompanyRecords(tenantDb(ctx.orgA), primary, [loser, foreign]), "ok");
  assert.equal(await exists("company", foreign), true);
  assert.equal((await prisma.serviceTicket.findFirstOrThrow({ where: { id: foreignTicket.id } })).companyId, foreign);
  const other = await makeCompany(ctx.orgA);
  assert.equal(await mergeCompanyRecords(tenantDb(ctx.orgA), foreign, [other]), "invalid");
  assert.equal(await exists("company", other), true);
});

async function main() {
  try {
    const a = await prisma.organization.create({ data: { name: `MERGE-DB-A-${stamp}`, slug: `merge-db-a-${stamp}` } });
    const b = await prisma.organization.create({ data: { name: `MERGE-DB-B-${stamp}`, slug: `merge-db-b-${stamp}` } });
    created.orgs.push(a.id, b.id);
    ctx.orgA = a.id;
    ctx.orgB = b.id;
    const u1 = await prisma.user.create({ data: { name: "U1", email: `merge-db-1-${stamp}@test.local`, passwordHash: "x" } });
    const u2 = await prisma.user.create({ data: { name: "U2", email: `merge-db-2-${stamp}@test.local`, passwordHash: "x" } });
    created.users.push(u1.id, u2.id);
    ctx.u1 = u1.id;
    ctx.u2 = u2.id;
    const number = await prisma.whatsappCloudNumber.create({
      data: {
        organizationId: a.id,
        ownerId: u1.id,
        phoneNumberId: `merge-pn-${stamp}`,
        wabaId: `merge-waba-${stamp}`,
        accessTokenEnc: "merge-not-a-token",
      },
    });
    ctx.cloudNumber = number.id;
    ctx.job = (await prisma.extractionJob.create({ data: { organizationId: a.id, createdById: u1.id } })).id;

    for (const c of cases) {
      await c.fn();
      console.log(`  ✓ ${c.name}`);
    }
    console.log(`\n✅ Duplicate merge (database): ${cases.length} checks passed.`);
  } finally {
    const org = { organizationId: { in: created.orgs } };
    // Official conversations go with their number (onDelete: Cascade); recipients with their campaign.
    await prisma.whatsappCloudNumber.deleteMany({ where: org });
    await prisma.campaign.deleteMany({ where: org });
    await prisma.extractedLead.deleteMany({ where: org });
    await prisma.extractionJob.deleteMany({ where: org });
    await prisma.serviceTicket.deleteMany({ where: org });
    await prisma.asset.deleteMany({ where: org });
    await prisma.task.deleteMany({ where: org });
    await prisma.pinnedItem.deleteMany({ where: org });
    await prisma.contact.deleteMany({ where: org });
    await prisma.company.deleteMany({ where: org });
    await prisma.organization.deleteMany({ where: { id: { in: created.orgs } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  }
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
