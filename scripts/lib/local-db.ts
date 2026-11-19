/**
 * Guard for the scripts that create and delete rows to check the database (check:isolation,
 * check:crm-matches and the check:*:db ones): they only run against a local Postgres, the Docker one or
 * the CI service, never against Supabase. Reads only the host of DATABASE_URL, never the whole URL (it
 * holds the password).
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
      `${script} creates and deletes test data: it only runs against a local Postgres (DATABASE_URL points at ${host}).`,
    );
  }
}
