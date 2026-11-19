/**
 * Database check of the social sign-in (src/lib/oauth/session.ts and providers.ts): how a provider
 * identity becomes a session. Runs `resolveOAuthSession` against the real Postgres and reads the result
 * back with the raw client.
 *
 * Covers: when Microsoft counts an address as verified (`microsoftEmailVerified`); an identity already
 * linked signs in without looking at the address; an unverified address never links nor creates; a
 * verified address links to the user with that address, keeping the password of a confirmed account
 * and dropping the password of an account whose address was never confirmed; a new address creates a
 * user and a company.
 *
 * Creates a company `OAUTH-DB-<stamp>` and users `oauth-db-*-<stamp>@test.local`, and ALWAYS deletes what
 * it created, even when a check fails. A run that is killed leaves them behind: delete by hand the users
 * whose e-mail starts with `oauth-db-` and the organizations they belong to.
 *
 * Run: npm run check:oauth:db   (needs the local Postgres up and a valid .env)
 * Exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertLocalDatabase } from "./lib/local-db";
import { resolveOAuthSession } from "@/lib/oauth/session";
import { microsoftEmailVerified } from "@/lib/oauth/providers";

const connectionString = process.env.DATABASE_URL;
assertLocalDatabase("check:oauth:db", connectionString);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const stamp = Date.now();
const mail = (who: string) => `oauth-db-${who}-${stamp}@test.local`;
const ctx = {} as { orgId: string; confirmed: string; unconfirmed: string };

type Case = { name: string; fn: () => Promise<void> | void };
const cases: Case[] = [];
function check(name: string, fn: () => Promise<void> | void) {
  cases.push({ name, fn });
}

async function makeUser(who: string, verified: boolean) {
  const u = await prisma.user.create({
    data: { name: who, email: mail(who), passwordHash: "x", emailVerified: verified ? new Date() : null },
  });
  await prisma.membership.create({ data: { organizationId: ctx.orgId, userId: u.id, role: "MEMBER" } });
  return u.id;
}

async function accountsOf(userId: string) {
  return prisma.account.findMany({ where: { userId }, select: { provider: true, providerAccountId: true } });
}

check("Microsoft: a personal account counts as verified", () => {
  assert.equal(microsoftEmailVerified({ tid: "9188040d-6c67-4c5b-b112-36a304b66dad" }), true);
});

check("Microsoft: a work/school account counts only with xms_edov", () => {
  const tid = "00000000-0000-0000-0000-000000000001";
  assert.equal(microsoftEmailVerified({ tid }), false);
  assert.equal(microsoftEmailVerified({ tid, xms_edov: false }), false);
  assert.equal(microsoftEmailVerified({ tid, xms_edov: true }), true);
  assert.equal(microsoftEmailVerified({ tid, xms_edov: "1" }), true);
  assert.equal(microsoftEmailVerified({}), false);
});

check("an unverified address neither links nor creates", async () => {
  const sub = `ms-${stamp}`;
  const r = await resolveOAuthSession("microsoft", {
    sub,
    email: mail("confirmed"),
    emailVerified: false,
    name: "x",
  });
  assert.deepEqual(r, { ok: false, error: "unverified" });
  assert.equal(await prisma.account.count({ where: { providerAccountId: sub } }), 0);
  assert.deepEqual(await accountsOf(ctx.confirmed), []);
});

check("a verified address links to a confirmed account and keeps its password", async () => {
  const r = await resolveOAuthSession("google", {
    sub: `g-confirmed-${stamp}`,
    email: mail("confirmed"),
    emailVerified: true,
    name: "x",
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.session.userId, ctx.confirmed);
  assert.deepEqual(await accountsOf(ctx.confirmed), [{ provider: "google", providerAccountId: `g-confirmed-${stamp}` }]);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.confirmed } });
  assert.equal(u.passwordHash, "x");
});

check("a verified address links to an unconfirmed account, confirms it and drops its password", async () => {
  const r = await resolveOAuthSession("google", {
    sub: `g-unconfirmed-${stamp}`,
    email: mail("unconfirmed"),
    emailVerified: true,
    name: "x",
  });
  assert.equal(r.ok && r.session.userId, ctx.unconfirmed);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.unconfirmed } });
  assert.notEqual(u.emailVerified, null);
  assert.equal(u.passwordHash, null);
});

check("an identity already linked signs in without looking at the address", async () => {
  const r = await resolveOAuthSession("google", {
    sub: `g-confirmed-${stamp}`,
    email: "anything-else@test.local",
    emailVerified: false,
    name: "x",
  });
  assert.equal(r.ok && r.session.userId, ctx.confirmed);
});

check("a new verified address creates a user and a company", async () => {
  const r = await resolveOAuthSession("google", {
    sub: `g-new-${stamp}`,
    email: mail("new"),
    emailVerified: true,
    name: `OAUTH-DB-NEW-${stamp}`,
  });
  assert.equal(r.ok && r.session.role, "OWNER");
  const u = await prisma.user.findUniqueOrThrow({ where: { email: mail("new") } });
  assert.equal(r.ok && r.session.userId, u.id);
  assert.equal(u.passwordHash, null);
});

async function main() {
  try {
    const org = await prisma.organization.create({ data: { name: `OAUTH-DB-${stamp}`, slug: `oauth-db-${stamp}` } });
    ctx.orgId = org.id;
    ctx.confirmed = await makeUser("confirmed", true);
    ctx.unconfirmed = await makeUser("unconfirmed", false);

    for (const c of cases) {
      await c.fn();
      console.log(`  ✓ ${c.name}`);
    }
    console.log(`\n✅ Social sign-in (database): ${cases.length} checks passed.`);
  } finally {
    // Every company any test user belongs to (the fixture one and the one the sign-up created).
    const users = await prisma.user.findMany({ where: { email: { startsWith: "oauth-db-", endsWith: `-${stamp}@test.local` } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    const orgIds = [
      ...new Set([
        ...(ctx.orgId ? [ctx.orgId] : []),
        ...(await prisma.membership.findMany({ where: { userId: { in: userIds } }, select: { organizationId: true } })).map(
          (m) => m.organizationId,
        ),
      ]),
    ];
    await prisma.pipeline.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    // Accounts go with their user (onDelete: Cascade).
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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
