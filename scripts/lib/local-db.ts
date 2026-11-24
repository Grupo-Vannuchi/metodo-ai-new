/**
 * Guard for the programs that write test or demo data to the database: check:isolation,
 * check:crm-matches, the check:*:db ones, check:mcp:e2e, check:automation:e2e, the wa-cloud-webhook
 * simulator and the seed (prisma/seed.ts). They only run against a local Postgres, the Docker one or the
 * CI service, never against Supabase. Reads only the host of DATABASE_URL, never the whole URL (it holds
 * the password). The other e2e checks carry the same guard in their own files.
 */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

export function assertLocalDatabase(
  script: string,
  connectionString: string | undefined,
): asserts connectionString is string {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `${script} writes test or demo data: it only runs against a local Postgres (DATABASE_URL points at ${host}).`,
    );
  }
}
