/**
 * Backfill: give a default pipeline (+ stages) to any organization that has
 * none — e.g. orgs created before the signup flow started creating one.
 *
 * Run: npm run backfill:pipelines
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createDefaultPipeline } from "../src/lib/default-pipeline";

// `engineType = "client"` (schema.prisma) drops the Rust engine, so every
// PrismaClient needs an explicit driver adapter — same as src/lib/prisma.ts.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, slug: true } });
  let created = 0;

  for (const org of orgs) {
    const has = await prisma.pipeline.findFirst({
      where: { organizationId: org.id },
      select: { id: true },
    });
    if (!has) {
      await prisma.$transaction((tx) => createDefaultPipeline(tx, org.id));
      created++;
      console.log(`  ✓ default pipeline created for ${org.slug}`);
    }
  }

  console.log(created === 0 ? "All organizations already have a pipeline." : `Done (${created}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
