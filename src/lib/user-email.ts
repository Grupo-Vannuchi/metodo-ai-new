import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Sign-in e-mails are case-insensitive. Since 27/11/2026 every address is saved
 * trimmed and in lower case (the zod schemas of signup, login, invite and e-mail
 * change lower-case it; OAuth providers already did). Accounts saved before may
 * still hold capitals, and `User.email @unique` compares case-sensitively, so a
 * lookup by `{ email }` alone missed them and let a second account be created
 * for the same inbox. Every lookup of a user BY E-MAIL goes through here.
 * Covered by `npm run check:oauth:db`.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type Db = Pick<Prisma.TransactionClient, "user" | "$queryRaw">;

/** Ids of the accounts whose e-mail equals `normalized` ignoring case. `lower() =`, never ILIKE: `_` and `%` are literal. */
async function idsIgnoringCase(db: Db, normalized: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "users" WHERE lower(email) = ${normalized} LIMIT 3`;
  return rows.map((r) => r.id);
}

/**
 * The account that owns `email`, ignoring case, or null. The exact (lower-case)
 * address wins; an old mixed-case account is used only when it is the only one,
 * so a legacy duplicate never makes the choice arbitrary.
 */
export async function findUserIdByEmail(email: string, db: Db = prisma): Promise<string | null> {
  const normalized = normalizeEmail(email);
  const exact = await db.user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (exact) return exact.id;
  const ids = await idsIgnoringCase(db, normalized);
  return ids.length === 1 ? ids[0] : null;
}

/** Whether some account other than `exceptUserId` already uses `email`, in any case. */
export async function isEmailTaken(email: string, exceptUserId?: string, db: Db = prisma): Promise<boolean> {
  const ids = await idsIgnoringCase(db, normalizeEmail(email));
  return ids.some((id) => id !== exceptUserId);
}
