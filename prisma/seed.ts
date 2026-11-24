import { PrismaClient, Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertLocalDatabase } from "../scripts/lib/local-db";
import bcrypt from "bcryptjs";
import { createDefaultPipeline } from "../src/lib/default-pipeline";

/**
 * Seed: creates a demo organization and its owner user, idempotently.
 * Credentials come from the environment (see .env / .env.example):
 *   SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD, SEED_ORG_NAME
 */
// `engineType = "client"` (schema.prisma) drops the Rust engine, so every
// PrismaClient needs an explicit driver adapter — same as src/lib/prisma.ts.
const connectionString = process.env.DATABASE_URL;
assertLocalDatabase("db:seed", connectionString);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function main() {
  const email = process.env.SEED_OWNER_EMAIL ?? "owner@metodoai.local";
  const password = process.env.SEED_OWNER_PASSWORD ?? "changeme123";
  const orgName = process.env.SEED_ORG_NAME ?? "MétodoAI Demo";
  const slug = slugify(orgName) || "metodoai-demo";

  const passwordHash = await bcrypt.hash(password, 10);

  // The owner comes first: the company records its account owner (Organization.ownerId), and
  // without it nobody is the account owner, so the module onboarding is stuck. The login is
  // gated on emailVerified (src/app/actions/auth.ts), so the seeded owner starts verified.
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Owner", passwordHash, emailVerified: new Date() },
  });

  const org = await prisma.organization.upsert({
    where: { slug },
    update: {},
    create: { name: orgName, slug, ownerId: user.id },
  });

  // Databases seeded before 19/11/2026 lack both: fill the gaps, never overwrite a value.
  await prisma.user.updateMany({ where: { id: user.id, emailVerified: null }, data: { emailVerified: new Date() } });
  await prisma.organization.updateMany({ where: { id: org.id, ownerId: null }, data: { ownerId: user.id } });

  await prisma.membership.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    update: { role: Role.OWNER },
    create: { organizationId: org.id, userId: user.id, role: Role.OWNER },
  });

  // Default pipeline (only if the org has none yet).
  const hasPipeline = await prisma.pipeline.findFirst({
    where: { organizationId: org.id },
    select: { id: true },
  });
  if (!hasPipeline) {
    await prisma.$transaction((tx) => createDefaultPipeline(tx, org.id));
  }

  console.log("✓ Seed complete");
  console.log(`  Organization: ${org.name} (${org.slug})`);
  console.log(`  Owner:        ${user.email}  /  password: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
