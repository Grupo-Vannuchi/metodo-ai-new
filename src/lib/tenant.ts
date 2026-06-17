import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getSession, type SessionRole } from "@/lib/session";
import { resolveAllowedScreens } from "@/lib/access";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * The tenant-scoped request context — the entry point for the Data Access Layer.
 *
 * EVERY query against tenant data must be filtered by `ctx.organizationId`
 * (see PLANO.md §5: the DAL is the security boundary). Pass the context (or just
 * its `organizationId`) into `src/lib/queries/*`; never query business tables
 * without it.
 */
export type OrgContext = {
  userId: string;
  organizationId: string;
  role: SessionRole;
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; slug: string; plan: string };
  /** Access template assigned to this membership (null = full access). */
  accessTemplateId: string | null;
  /** Screen keys this member can reach (see src/lib/access.ts). */
  allowedScreens: string[];
};

/**
 * Resolve the active tenant context from the session. Re-validates that the
 * membership still exists (a user removed from the org loses access immediately,
 * even if their cookie is still valid). Cached per request. Returns null when
 * unauthenticated or when the membership no longer exists.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const session = await getSession();
  if (!session) return null;

  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: session.organizationId,
        userId: session.userId,
      },
    },
    select: {
      role: true,
      accessTemplateId: true,
      accessTemplate: { select: { screens: true } },
      user: { select: { id: true, name: true, email: true } },
      organization: {
        select: { id: true, name: true, slug: true, plan: true },
      },
    },
  });

  if (!membership) return null;

  const templateScreens = membership.accessTemplate?.screens ?? null;

  return {
    userId: membership.user.id,
    organizationId: membership.organization.id,
    role: membership.role,
    user: membership.user,
    organization: membership.organization,
    accessTemplateId: membership.accessTemplateId,
    allowedScreens: resolveAllowedScreens(membership.role, templateScreens),
  };
});

/**
 * Guard for app (dashboard) pages. Redirects to the locale-aware login route
 * when there is no valid tenant context; otherwise returns it.
 */
export async function requireOrgContext(locale: Locale): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (ctx) return ctx;
  redirect({ href: "/login", locale });
  throw new Error("unreachable: redirect halts execution");
}

const ROLE_RANK: Record<SessionRole, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/** True when `role` meets or exceeds the required minimum role. */
export function hasRole(role: SessionRole, min: SessionRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Throws when the context's role is below the required minimum. Use at the top
 * of privileged Server Actions (e.g. removing a member requires ADMIN).
 */
export function assertRole(ctx: OrgContext, min: SessionRole): void {
  if (!hasRole(ctx.role, min)) {
    throw new Error(`Forbidden: requires role ${min} or higher`);
  }
}
