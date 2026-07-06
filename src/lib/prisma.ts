import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

/**
 * Single shared PrismaClient instance, backed by the `pg` driver adapter.
 *
 * The client is generated Rust-engine-free (`queryCompiler` + `driverAdapters`
 * in schema.prisma): queries are compiled in-process and executed through
 * node-postgres. This is what makes it run on Hostinger/Passenger, where the
 * native query engines fail (library → "timer has gone away" on fork; binary →
 * "spawn EAGAIN" under the process cap).
 *
 * In development Next.js clears the module cache on every hot reload, which would
 * otherwise spawn a new client (and a new connection pool) each time. Caching it
 * on `globalThis` keeps a single instance across reloads.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrisma(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
