import { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";

/**
 * Single shared PrismaClient instance.
 *
 * In development Next.js clears the module cache on every hot reload, which would
 * otherwise spawn a new client (and a new connection pool) each time. Caching it
 * on `globalThis` keeps a single instance across reloads.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
