import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Names of the users referenced by org-scoped rows (owner, assignee…). `User`
 * is a global model: the ids come from rows already filtered by organization,
 * and only `name` is read.
 */
export async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}
