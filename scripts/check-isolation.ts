/**
 * Tenant isolation check (PLANO.md §5/§12).
 *
 * Creates two organizations with one member each, then asserts that:
 *   1. A query scoped by `organizationId` returns ONLY that org's members.
 *   2. A cross-tenant membership lookup (orgB + userA) returns null.
 *   3. A guarded update `where: { id, organizationId }` from the wrong org
 *      affects 0 rows (the pattern every business write must follow).
 *
 * Run: npm run check:isolation   (requires the local Postgres up)
 * Exits non-zero on any failed assertion. Cleans up its own data.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// `engineType = "client"` (schema.prisma) drops the Rust engine, so every
// PrismaClient needs an explicit driver adapter — same as src/lib/prisma.ts.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(`ISOLATION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function main() {
  const stamp = Date.now();
  const created = { orgs: [] as string[], users: [] as string[] };

  try {
    const orgA = await prisma.organization.create({
      data: { name: `ISO-A-${stamp}`, slug: `iso-a-${stamp}` },
    });
    const orgB = await prisma.organization.create({
      data: { name: `ISO-B-${stamp}`, slug: `iso-b-${stamp}` },
    });
    created.orgs.push(orgA.id, orgB.id);

    const userA = await prisma.user.create({
      data: { name: "A", email: `iso-a-${stamp}@test.local`, passwordHash: "x" },
    });
    const userB = await prisma.user.create({
      data: { name: "B", email: `iso-b-${stamp}@test.local`, passwordHash: "x" },
    });
    created.users.push(userA.id, userB.id);

    await prisma.membership.create({
      data: { organizationId: orgA.id, userId: userA.id, role: "OWNER" },
    });
    await prisma.membership.create({
      data: { organizationId: orgB.id, userId: userB.id, role: "OWNER" },
    });

    // 1) Scoped read returns only the tenant's own members.
    const membersA = await prisma.membership.findMany({
      where: { organizationId: orgA.id },
      include: { user: true },
    });
    assert(
      membersA.length === 1 && membersA[0].user.id === userA.id,
      "scoped read on org A returns only user A",
    );

    // 2) Cross-tenant membership lookup is null (userA is not in orgB).
    const cross = await prisma.membership.findUnique({
      where: {
        organizationId_userId: { organizationId: orgB.id, userId: userA.id },
      },
    });
    assert(cross === null, "cross-tenant membership lookup (orgB + userA) is null");

    // 3) Guarded update from the wrong org affects 0 rows.
    const wrongOrgUpdate = await prisma.organization.updateMany({
      where: { id: orgB.id, /* pretend acting tenant */ slug: orgA.slug },
      data: { name: "HACKED" },
    });
    assert(
      wrongOrgUpdate.count === 0,
      "guarded update with mismatched tenant filter affects 0 rows",
    );

    // 4) CRM data is tenant-scoped too: a company created in org A is invisible
    //    to a query scoped to org B, and a cross-tenant guarded delete is a no-op.
    const companyA = await prisma.company.create({
      data: { organizationId: orgA.id, name: `ISO-CO-A-${stamp}` },
    });
    await prisma.company.create({
      data: { organizationId: orgB.id, name: `ISO-CO-B-${stamp}` },
    });
    const companiesB = await prisma.company.findMany({
      where: { organizationId: orgB.id, name: { startsWith: "ISO-CO-" } },
    });
    assert(
      companiesB.length === 1 && companiesB[0].name.endsWith("-B-" + stamp),
      "company list scoped to org B excludes org A's company",
    );
    const wrongDelete = await prisma.company.deleteMany({
      where: { id: companyA.id, organizationId: orgB.id },
    });
    assert(
      wrongDelete.count === 0,
      "deleting org A's company with org B filter affects 0 rows",
    );

    // 5) Integration connections are tenant-scoped too.
    await prisma.integrationConnection.create({
      data: {
        organizationId: orgA.id,
        provider: "EVOLUTION",
        label: `ISO-CONN-A-${stamp}`,
        credentialsEnc: "iv:tag:data",
      },
    });
    const connsB = await prisma.integrationConnection.findMany({
      where: { organizationId: orgB.id },
    });
    assert(
      connsB.length === 0,
      "connection list scoped to org B excludes org A's connection",
    );

    // 6) Campaigns are tenant-scoped too.
    await prisma.campaign.create({
      data: {
        organizationId: orgA.id,
        name: `ISO-CAMP-A-${stamp}`,
        channel: "EMAIL",
        createdById: userA.id,
      },
    });
    const campsB = await prisma.campaign.findMany({
      where: { organizationId: orgB.id },
    });
    assert(
      campsB.length === 0,
      "campaign list scoped to org B excludes org A's campaign",
    );

    // 7) Extraction (prospecting) jobs are tenant-scoped too.
    await prisma.extractionJob.create({
      data: { organizationId: orgA.id, createdById: userA.id },
    });
    const jobsB = await prisma.extractionJob.findMany({
      where: { organizationId: orgB.id },
    });
    assert(
      jobsB.length === 0,
      "extraction list scoped to org B excludes org A's job",
    );

    // 8) Inbox conversations are tenant-scoped too.
    await prisma.conversation.create({
      data: { organizationId: orgA.id, connectionId: `iso-conn-${stamp}`, remoteJid: `iso-${stamp}@s.whatsapp.net` },
    });
    const convosB = await prisma.conversation.findMany({
      where: { organizationId: orgB.id },
    });
    assert(
      convosB.length === 0,
      "conversation list scoped to org B excludes org A's conversation",
    );

    // 9) Mass e-mail broadcasts and their recipients are tenant-scoped too.
    const broadcastA = await prisma.emailBroadcast.create({
      data: {
        organizationId: orgA.id,
        subject: `ISO-EB-A-${stamp}`,
        html: "<p>x</p>",
        createdById: userA.id,
      },
    });
    await prisma.emailBroadcastRecipient.create({
      data: {
        organizationId: orgA.id,
        broadcastId: broadcastA.id,
        email: `iso-${stamp}@example.com`,
        batchNo: 0,
      },
    });
    const broadcastsB = await prisma.emailBroadcast.findMany({
      where: { organizationId: orgB.id },
    });
    assert(
      broadcastsB.length === 0,
      "email broadcast list scoped to org B excludes org A's broadcast",
    );
    const recipientsB = await prisma.emailBroadcastRecipient.findMany({
      where: { organizationId: orgB.id },
    });
    assert(
      recipientsB.length === 0,
      "email recipient list scoped to org B excludes org A's recipient",
    );

    // 10) The suppression list is per org: an address blocked in A is still
    // free in B (the unique key is [organizationId, email]).
    const blockedEmail = `iso-block-${stamp}@example.com`;
    await prisma.emailSuppression.create({
      data: { organizationId: orgA.id, email: blockedEmail, reason: "UNSUBSCRIBED" },
    });
    const blockedInB = await prisma.emailSuppression.findMany({
      where: { organizationId: orgB.id, email: blockedEmail },
    });
    assert(
      blockedInB.length === 0,
      "an address suppressed in org A is not suppressed in org B",
    );

    // 11) Sender domains are per org, and a domain belongs to ONE org (unique).
    const senderDomain = `iso-${stamp}.example.com`;
    await prisma.emailSenderDomain.create({
      data: { organizationId: orgA.id, domain: senderDomain },
    });
    const domainsB = await prisma.emailSenderDomain.findMany({
      where: { organizationId: orgB.id },
    });
    assert(
      domainsB.length === 0,
      "sender domain list scoped to org B excludes org A's domain",
    );
    let duplicateRejected = false;
    try {
      await prisma.emailSenderDomain.create({
        data: { organizationId: orgB.id, domain: senderDomain },
      });
    } catch {
      duplicateRejected = true;
    }
    assert(duplicateRejected, "the same sender domain cannot be assigned to a second org");

    console.log("\n✅ Tenant isolation: all checks passed.");
  } finally {
    // Cleanup. Companies/connections carry organizationId (no FK cascade from
    // org), so remove them explicitly before the orgs.
    await prisma.emailSenderDomain.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
    await prisma.emailSuppression.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
    // Recipients go with their broadcast (onDelete: Cascade).
    await prisma.emailBroadcast.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
    await prisma.conversation.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
    await prisma.extractionJob.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
    await prisma.campaign.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
    await prisma.integrationConnection.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
    await prisma.company.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
    await prisma.membership.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
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
