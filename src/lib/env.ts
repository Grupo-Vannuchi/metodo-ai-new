import { z } from "zod";

/**
 * Centralised, validated access to environment variables.
 *
 * Importing `env` anywhere guarantees the required variables exist and have the
 * right shape — the process fails fast at boot instead of throwing deep inside a
 * request. Only `NEXT_PUBLIC_*` values are safe to read in the browser; the rest
 * are server-only and must never be imported into a Client Component.
 *
 * Later phases extend this schema (QStash/Redis in P4, integration keys in
 * P5/P6). Add a field here the moment code starts reading it — never read
 * `process.env.X` directly.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection string"),
  // Direct (non-pooled) connection for Prisma Migrate. Only used by the Prisma
  // CLI, not at runtime — optional so the app still boots without it.
  DIRECT_URL: z
    .string()
    .url("DIRECT_URL must be a valid connection string")
    .optional(),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters for HS256 signing"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url("NEXT_PUBLIC_SITE_URL must be an absolute URL")
    .default("http://localhost:3000"),
});

function formatErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

const isServer = typeof window === "undefined";

function parseServerEnv() {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment variables:\n${formatErrors(parsed.error)}`,
    );
  }
  return parsed.data;
}

function parseClientEnv() {
  // NEXT_PUBLIC_* values are statically inlined by Next, so reference them directly.
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid public environment variables:\n${formatErrors(parsed.error)}`,
    );
  }
  return parsed.data;
}

const clientEnv = parseClientEnv();

/**
 * Server env is only validated on the server. On the client the server fields
 * are left undefined (and must never be accessed there).
 */
export const env = {
  ...clientEnv,
  ...(isServer ? parseServerEnv() : ({} as ReturnType<typeof parseServerEnv>)),
};
