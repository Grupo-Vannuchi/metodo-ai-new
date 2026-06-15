import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
};

/**
 * Resolve the logged-in user (identity only, no org scope). Verifies the
 * session cookie and confirms the user still exists. Cached per request so
 * multiple components share one lookup. Returns null when unauthenticated.
 *
 * For tenant-scoped work use `getOrgContext()` in `@/lib/tenant`, which also
 * resolves the active organization and the user's role within it.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  if (!session) return null;

  return prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true },
  });
});
