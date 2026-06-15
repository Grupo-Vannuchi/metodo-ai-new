import { PrismaClient, Plan, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Seed: creates a demo organization and its owner user, idempotently.
 * Credentials come from the environment (see .env / .env.example):
 *   SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD, SEED_ORG_NAME
 */
const prisma = new PrismaClient();

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

  const org = await prisma.organization.upsert({
    where: { slug },
    update: {},
    create: { name: orgName, slug, plan: Plan.GOLD, seatLimit: 25 },
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Owner", passwordHash },
  });

  await prisma.membership.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    update: { role: Role.OWNER },
    create: { organizationId: org.id, userId: user.id, role: Role.OWNER },
  });

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
