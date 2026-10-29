/**
 * Database check of contacts in several folders (spec 2026-10-29): what only the real
 * Postgres can prove. Today: the phase-1 trigger that mirrors the legacy `contacts.folderId`
 * into `contact_folder_links` (migration 20261029120000). Later tasks add their cases.
 *
 * Contacts and their `folderId` are written with raw SQL so the script survives the rename
 * of the Prisma field (Task 8). Every case creates its own contacts. The folders FA1..FA3 of
 * company A live for the whole run; a case that deletes a folder creates its own.
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

const ctx = {} as { orgA: string; orgB: string; fa1: string; fa2: string; fa3: string };

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
