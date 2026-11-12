/**
 * Database check of contacts in several folders (spec 2026-10-29): what only the real
 * Postgres can prove. Covers the phase-1 trigger that mirrors the legacy `contacts.folderId`
 * into `contact_folder_links` (migration 20261029120000); the board and `getContact`; move, add
 * and remove (with another org's folder or contact, and a missing move origin); the e-mail and
 * campaign folder filters; the duplicate merge; and the WhatsApp import (the only
 * `createManyAndReturn` in src/).
 *
 * Contacts and their `folderId` are written with raw SQL so the script survives the rename
 * of the Prisma field (Task 8). `makeContact` files a contact through that legacy column and the
 * trigger; phase 2 (README §10, item 5) must rewrite it to insert without `folderId` and use
 * `addLink`, and drop the `trigger:` cases, before the column goes. Every case creates its own
 * contacts. The folders FA1..FA3 of company A live for the whole run; a case that deletes a
 * folder creates its own.
 *
 * Creates two companies (`FOLDERS-DB-A/B-<stamp>`) and ALWAYS deletes what it created, in
 * this order: contacts (their links go in cascade), folders, companies. A run that is killed leaves them behind:
 * delete by hand the organizations whose `slug` starts with `folders-db-` (LIKE is case-sensitive).
 *
 * Run: npm run check:folders:db   (needs the local Postgres up and a valid .env)
 * Exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { contactFolderEmailCounts, getContactsBoard } from "@/lib/queries/contact-folders";
import { resolveAudience } from "@/lib/email-broadcast/audience";
import { EMPTY_AUDIENCE } from "@/lib/validations/email-broadcast";
import { audienceWhere } from "@/lib/queries/campaigns";
import { getContact } from "@/lib/queries/contacts";
import { tenantDb } from "@/lib/tenant-db";
import {
  addContactsToFolder,
  mergeContactFolderLinks,
  moveContactsToFolder,
  removeContactsFromFolder,
} from "@/lib/crm/contact-folder-links";
import { createWhatsappContacts } from "@/lib/crm/whatsapp-import-contacts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const stamp = Date.now();
const created = {
  orgs: [] as string[],
};

type Case = { name: string; fn: () => Promise<void> };
const cases: Case[] = [];
function check(name: string, fn: () => Promise<void>) {
  cases.push({ name, fn });
}

const ctx = {} as { orgA: string; orgB: string; fa1: string; fa2: string; fa3: string; fb1: string };

async function makeFolder(organizationId: string, name: string) {
  const folder = await prisma.contactFolder.create({ data: { organizationId, name } });
  return folder.id;
}

/** Inserts a contact by raw SQL; `folderId` is the legacy column. */
async function makeContact(organizationId: string, name: string, folderId: string | null) {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "contacts" ("id", "organizationId", "name", "folderId", "updatedAt")
    VALUES (${id}, ${organizationId}, ${name}, ${folderId}, now())`;
  return id;
}

async function linksOf(contactId: string) {
  const rows = await prisma.$queryRaw<{ folderId: string }[]>`
    SELECT "folderId" FROM "contact_folder_links" WHERE "contactId" = ${contactId}`;
  return rows.map((r) => r.folderId).sort();
}

async function addLink(organizationId: string, contactId: string, folderId: string) {
  await prisma.$executeRaw`
    INSERT INTO "contact_folder_links" ("id", "organizationId", "contactId", "folderId", "createdAt")
    VALUES (${randomUUID()}, ${organizationId}, ${contactId}, ${folderId}, now())`;
}

check("trigger: insert with folderId creates the link", async () => {
  const t = await makeContact(ctx.orgA, `t1-${stamp}`, ctx.fa1);
  assert.deepEqual(await linksOf(t), [ctx.fa1]);
});

check("trigger: changing folderId moves the link", async () => {
  const t = await makeContact(ctx.orgA, `t2-${stamp}`, ctx.fa1);
  await prisma.$executeRaw`UPDATE "contacts" SET "folderId" = ${ctx.fa2} WHERE "id" = ${t}`;
  assert.deepEqual(await linksOf(t), [ctx.fa2]);
});

check("trigger: an extra link survives a folderId change", async () => {
  const t = await makeContact(ctx.orgA, `t3-${stamp}`, ctx.fa2);
  await addLink(ctx.orgA, t, ctx.fa3);
  await prisma.$executeRaw`UPDATE "contacts" SET "folderId" = ${ctx.fa1} WHERE "id" = ${t}`;
  assert.deepEqual(await linksOf(t), [ctx.fa1, ctx.fa3].sort());
});

check("trigger: folderId null removes only the legacy link", async () => {
  const t = await makeContact(ctx.orgA, `t4-${stamp}`, ctx.fa1);
  await addLink(ctx.orgA, t, ctx.fa3);
  await prisma.$executeRaw`UPDATE "contacts" SET "folderId" = NULL WHERE "id" = ${t}`;
  assert.deepEqual(await linksOf(t), [ctx.fa3]);
});

check("trigger: deleting a folder keeps the contact", async () => {
  const fa4 = await makeFolder(ctx.orgA, `FA4-${stamp}`);
  const t = await makeContact(ctx.orgA, `t5-${stamp}`, fa4);
  await addLink(ctx.orgA, t, ctx.fa3);
  await prisma.contactFolder.deleteMany({ where: { id: fa4, organizationId: ctx.orgA } });
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "contacts" WHERE "id" = ${t}`;
  assert.equal(rows.length, 1);
  assert.deepEqual(await linksOf(t), [ctx.fa3]);
});

check("trigger: the link carries the contact's organizationId", async () => {
  const t = await makeContact(ctx.orgA, `t6-${stamp}`, ctx.fa1);
  const rows = await prisma.$queryRaw<{ organizationId: string }[]>`
    SELECT "organizationId" FROM "contact_folder_links" WHERE "contactId" = ${t}`;
  assert.deepEqual(rows.map((r) => r.organizationId), [ctx.orgA]);
});

check("trigger: moving folderId onto an already linked folder leaves one link there", async () => {
  const t = await makeContact(ctx.orgA, `t7-${stamp}`, ctx.fa1);
  await addLink(ctx.orgA, t, ctx.fa2);
  await prisma.$executeRaw`UPDATE "contacts" SET "folderId" = ${ctx.fa2} WHERE "id" = ${t}`;
  assert.deepEqual(await linksOf(t), [ctx.fa2]);
});

check("board: a contact in two folders shows in both", async () => {
  const x = await makeContact(ctx.orgA, `b1-${stamp}`, ctx.fa1);
  await addLink(ctx.orgA, x, ctx.fa2);
  const { columns } = await getContactsBoard(ctx.orgA);
  const col = (id: string | null) => columns.find((c) => c.id === id)!;
  const card = col(ctx.fa1).contacts.find((c) => c.id === x);
  assert.ok(card, "missing from FA1");
  assert.ok(col(ctx.fa2).contacts.some((c) => c.id === x), "missing from FA2");
  assert.ok(!col(ctx.fa3).contacts.some((c) => c.id === x));
  assert.ok(!col(null).contacts.some((c) => c.id === x), "must not be in Sem pasta");
  assert.deepEqual(card.folderNames, [`FA1-${stamp}`, `FA2-${stamp}`]);
});

check("board: a contact without links is in Sem pasta", async () => {
  const x = await makeContact(ctx.orgA, `b2-${stamp}`, null);
  const { columns } = await getContactsBoard(ctx.orgA);
  const card = columns.find((c) => c.id === null)!.contacts.find((c) => c.id === x);
  assert.ok(card, "missing from Sem pasta");
  assert.deepEqual(card.folderNames, []);
  for (const c of columns.filter((c) => c.id !== null)) {
    assert.ok(!c.contacts.some((k) => k.id === x), `must not be in ${c.name}`);
  }
});

check("board: a link pointing at another org's contact never shows it", async () => {
  const y = await makeContact(ctx.orgB, `b3-${stamp}`, null);
  await addLink(ctx.orgA, y, ctx.fa1);
  const { columns } = await getContactsBoard(ctx.orgA);
  for (const c of columns) assert.ok(!c.contacts.some((k) => k.id === y), `leaked into ${c.name}`);
});

check("getContact lists the contact's folders", async () => {
  const x = await makeContact(ctx.orgA, `b4-${stamp}`, ctx.fa1);
  await addLink(ctx.orgA, x, ctx.fa2);
  const c = await getContact(ctx.orgA, x);
  assert.ok(c);
  assert.deepEqual(c.folderLinks.map((l) => l.folder.name).sort(), [`FA1-${stamp}`, `FA2-${stamp}`]);
});

check("move: A→B keeps the contact's other folders", async () => {
  const x = await makeContact(ctx.orgA, `m1-${stamp}`, ctx.fa1);
  await addLink(ctx.orgA, x, ctx.fa3);
  const n = await moveContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x], ctx.fa2, ctx.fa1);
  assert.equal(n, 1);
  assert.deepEqual(await linksOf(x), [ctx.fa2, ctx.fa3].sort());
});

check("move: to Sem pasta removes every link", async () => {
  const x = await makeContact(ctx.orgA, `m2-${stamp}`, ctx.fa1);
  await addLink(ctx.orgA, x, ctx.fa3);
  await moveContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x], null, ctx.fa1);
  assert.deepEqual(await linksOf(x), []);
});

check("move: from Sem pasta adds the folder", async () => {
  const x = await makeContact(ctx.orgA, `m3-${stamp}`, null);
  const n = await moveContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x], ctx.fa1, null);
  assert.equal(n, 1);
  assert.deepEqual(await linksOf(x), [ctx.fa1]);
});

check("move: into a folder it is already in", async () => {
  const x = await makeContact(ctx.orgA, `m4-${stamp}`, ctx.fa1);
  await addLink(ctx.orgA, x, ctx.fa2);
  await moveContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x], ctx.fa2, ctx.fa1);
  assert.deepEqual(await linksOf(x), [ctx.fa2]);
});

check("move: same folder is a no-op", async () => {
  const x = await makeContact(ctx.orgA, `m5-${stamp}`, ctx.fa1);
  await addLink(ctx.orgA, x, ctx.fa3);
  const n = await moveContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x], ctx.fa1, ctx.fa1);
  assert.equal(n, 0);
  assert.deepEqual(await linksOf(x), [ctx.fa1, ctx.fa3].sort());
});

check("move: another org's folder is refused", async () => {
  const x = await makeContact(ctx.orgA, `m6-${stamp}`, ctx.fa1);
  const n = await moveContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x], ctx.fb1, ctx.fa1);
  assert.equal(n, null);
  assert.deepEqual(await linksOf(x), [ctx.fa1]);
});

check("move: foreign contact", async () => {
  const x = await makeContact(ctx.orgA, `m7-${stamp}`, ctx.fa1);
  const y = await makeContact(ctx.orgB, `m7b-${stamp}`, null);
  const n = await moveContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x, y], ctx.fa2, ctx.fa1);
  assert.equal(n, 1);
  assert.deepEqual(await linksOf(x), [ctx.fa2]);
  assert.deepEqual(await linksOf(y), []);
});

check("move: an undefined origin is refused and deletes nothing", async () => {
  // An old client bundle calling with 2 args sends no origin; Prisma reads `folderId: undefined` as no filter.
  const x = await makeContact(ctx.orgA, `m8-${stamp}`, ctx.fa1);
  await addLink(ctx.orgA, x, ctx.fa3);
  const n = await moveContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x], ctx.fa2, undefined as unknown as null);
  assert.deepEqual(await linksOf(x), [ctx.fa1, ctx.fa3].sort());
  assert.equal(n, null);
});

check("add: keeps the current folders", async () => {
  const x = await makeContact(ctx.orgA, `a1-${stamp}`, ctx.fa1);
  const n = await addContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x], ctx.fa2);
  assert.equal(n, 1);
  assert.deepEqual(await linksOf(x), [ctx.fa1, ctx.fa2].sort());
});

check("add: twice is harmless", async () => {
  const x = await makeContact(ctx.orgA, `a2-${stamp}`, ctx.fa1);
  await addContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x], ctx.fa2);
  const n = await addContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x], ctx.fa2);
  assert.equal(n, 0);
  assert.deepEqual(await linksOf(x), [ctx.fa1, ctx.fa2].sort());
});

check("add: another org's folder is refused", async () => {
  const x = await makeContact(ctx.orgA, `a3-${stamp}`, ctx.fa1);
  const n = await addContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [x], ctx.fb1);
  assert.equal(n, null);
  assert.deepEqual(await linksOf(x), [ctx.fa1]);
});

check("add: foreign contact", async () => {
  const y = await makeContact(ctx.orgB, `a4-${stamp}`, null);
  const n = await addContactsToFolder(tenantDb(ctx.orgA), ctx.orgA, [y], ctx.fa2);
  assert.equal(n, 0);
  assert.deepEqual(await linksOf(y), []);
});

check("remove: only from that folder", async () => {
  const x = await makeContact(ctx.orgA, `r1-${stamp}`, ctx.fa1);
  await addLink(ctx.orgA, x, ctx.fa2);
  const n = await removeContactsFromFolder(tenantDb(ctx.orgA), [x], ctx.fa1);
  assert.equal(n, 1);
  assert.deepEqual(await linksOf(x), [ctx.fa2]);
});

check("remove: the last folder sends it to Sem pasta", async () => {
  const x = await makeContact(ctx.orgA, `r2-${stamp}`, ctx.fa1);
  await removeContactsFromFolder(tenantDb(ctx.orgA), [x], ctx.fa1);
  assert.deepEqual(await linksOf(x), []);
  const { columns } = await getContactsBoard(ctx.orgA);
  assert.ok(columns.find((c) => c.id === null)!.contacts.some((c) => c.id === x), "missing from Sem pasta");
  assert.ok(!columns.find((c) => c.id === ctx.fa1)!.contacts.some((c) => c.id === x));
});

check("merge: the primary ends up in every folder", async () => {
  const p = await makeContact(ctx.orgA, `g0-${stamp}`, ctx.fa1);
  const l1 = await makeContact(ctx.orgA, `g1-${stamp}`, ctx.fa1);
  await addLink(ctx.orgA, l1, ctx.fa2);
  const l2 = await makeContact(ctx.orgA, `g2-${stamp}`, ctx.fa2);
  await addLink(ctx.orgA, l2, ctx.fa3);
  await tenantDb(ctx.orgA).$transaction((tx) => mergeContactFolderLinks(tx, p, [l1, l2]));
  assert.deepEqual(await linksOf(p), [ctx.fa1, ctx.fa2, ctx.fa3].sort());
  assert.deepEqual(await linksOf(l1), []);
  assert.deepEqual(await linksOf(l2), []);
});

/** Gives a contact an e-mail and an opt-out flag (raw SQL, like makeContact). */
async function setEmail(contactId: string, email: string, optedOut = false) {
  await prisma.$executeRaw`
    UPDATE "contacts" SET "email" = ${email}, "optedOut" = ${optedOut}, "updatedAt" = now()
    WHERE "id" = ${contactId}`;
}

/** x: e-mail, in f1 and f2. o: e-mail, in f1, opted out. Returns their ids and e-mails. Org-wide counts
 * (e2, c1) pass their own folders so other cases' contacts don't add to them. */
async function emailFixture(tag: string, f1 = ctx.fa1, f2 = ctx.fa2) {
  const x = await makeContact(ctx.orgA, `${tag}x-${stamp}`, f1);
  await addLink(ctx.orgA, x, f2);
  const xEmail = `${tag}x-${stamp}@folders-db.test`;
  await setEmail(x, xEmail);
  const o = await makeContact(ctx.orgA, `${tag}o-${stamp}`, f1);
  const oEmail = `${tag}o-${stamp}@folders-db.test`;
  await setEmail(o, oEmail, true);
  return { x, xEmail, o, oEmail };
}

check("e-mail: a contact in two chosen folders gets one e-mail", async () => {
  const { x, o, xEmail, oEmail } = await emailFixture("e1");
  await addLink(ctx.orgA, x, ctx.fa3); // x: fa2 and fa3 by link alone (legacy folderId is fa1)
  await addLink(ctx.orgA, o, ctx.fa2); // the opted-out contact is in a chosen folder too
  const { recipients } = await resolveAudience(ctx.orgA, { ...EMPTY_AUDIENCE, contactFolderIds: [ctx.fa2, ctx.fa3] });
  assert.equal(recipients.filter((r) => r.email === xEmail).length, 1);
  assert.equal(recipients.filter((r) => r.email === oEmail).length, 0);
});

check("e-mail: folder counts include a contact in both folders", async () => {
  const g1 = await makeFolder(ctx.orgA, `FE1-${stamp}`);
  const g2 = await makeFolder(ctx.orgA, `FE2-${stamp}`);
  await emailFixture("e2", g1, g2);
  const counts = await contactFolderEmailCounts(ctx.orgA);
  assert.equal(counts.get(g1), 1);
  assert.equal(counts.get(g2), 1);
});

check("campaign: folder filter matches by link", async () => {
  const g1 = await makeFolder(ctx.orgA, `FC1-${stamp}`);
  const g2 = await makeFolder(ctx.orgA, `FC2-${stamp}`);
  await emailFixture("c1", g1, g2);
  const n = await tenantDb(ctx.orgA).contact.count({ where: audienceWhere("EMAIL", { folderId: g2 }) });
  assert.equal(n, 1);
});

check("WhatsApp import: contacts and their folder links carry the organization", async () => {
  // The only createManyAndReturn in src/, inside an interactive transaction on the engine-less client.
  const fw = await makeFolder(ctx.orgA, `FW-${stamp}`);
  const names = [`w1-${stamp}`, `w2-${stamp}`];
  // Fictional, non-dialable numbers: this never reaches WhatsApp.
  const rows = names.map((name, i) => ({ name, phone: `(00) 00000-000${i}` }));
  await createWhatsappContacts(tenantDb(ctx.orgA), ctx.orgA, rows, fw);
  // Read by name with the raw client (no org filter), so a contact written into the wrong org shows up.
  const made = await prisma.contact.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true, organizationId: true, tags: true, source: true },
    orderBy: { name: "asc" },
  });
  assert.deepEqual(made.map((c) => c.name), names);
  for (const c of made) {
    assert.equal(c.organizationId, ctx.orgA);
    assert.deepEqual(c.tags, ["whatsapp"]);
    assert.equal(c.source, "whatsapp-import");
    const links = await prisma.$queryRaw<{ folderId: string; organizationId: string }[]>`
      SELECT "folderId", "organizationId" FROM "contact_folder_links" WHERE "contactId" = ${c.id}`;
    assert.deepEqual(links, [{ folderId: fw, organizationId: ctx.orgA }]);
  }
});

async function main() {
  try {
    const a = await prisma.organization.create({
      data: { name: `FOLDERS-DB-A-${stamp}`, slug: `folders-db-a-${stamp}` },
    });
    const b = await prisma.organization.create({
      data: { name: `FOLDERS-DB-B-${stamp}`, slug: `folders-db-b-${stamp}` },
    });
    created.orgs.push(a.id, b.id);
    ctx.orgA = a.id;
    ctx.orgB = b.id;
    ctx.fa1 = await makeFolder(a.id, `FA1-${stamp}`);
    ctx.fa2 = await makeFolder(a.id, `FA2-${stamp}`);
    ctx.fa3 = await makeFolder(a.id, `FA3-${stamp}`);
    ctx.fb1 = await makeFolder(b.id, `FB1-${stamp}`);

    for (const c of cases) {
      await c.fn();
      console.log(`  ✓ ${c.name}`);
    }
    console.log(`\n✅ Contact folders (database): ${cases.length} checks passed.`);
  } finally {
    // Links go with their contact or folder (onDelete: Cascade).
    await prisma.contact.deleteMany({ where: { organizationId: { in: created.orgs } } });
    await prisma.contactFolder.deleteMany({ where: { organizationId: { in: created.orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: created.orgs } } });
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
