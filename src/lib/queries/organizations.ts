import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionRole } from "@/lib/session";

export type UserOrganization = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: SessionRole;
};

/**
 * All organizations the user belongs to, with the user's role in each. Drives
 * the org switcher. Identity-level read (not tenant-scoped): it is filtered by
 * `userId`, which is the natural boundary here.
 */
export async function listOrganizationsForUser(
  userId: string,
): Promise<UserOrganization[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: {
      role: true,
      organization: { select: { id: true, name: true, slug: true, plan: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    plan: m.organization.plan,
    role: m.role,
  }));
}

/**
 * Count current members of an organization — used to enforce `seatLimit` before
 * accepting an invitation.
 */
export function countMembers(organizationId: string): Promise<number> {
  return prisma.membership.count({ where: { organizationId } });
}

export type OrgMember = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: SessionRole;
  accessTemplateId: string | null;
  accessTemplateName: string | null;
  joinedAt: Date;
};

/**
 * List the members of an organization. Tenant-scoped: filtered by
 * `organizationId` (the security boundary). Pass `ctx.organizationId`.
 */
export async function listMembers(
  organizationId: string,
): Promise<OrgMember[]> {
  const memberships = await prisma.membership.findMany({
    where: { organizationId },
    select: {
      id: true,
      role: true,
      createdAt: true,
      accessTemplateId: true,
      accessTemplate: { select: { name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    accessTemplateId: m.accessTemplateId,
    accessTemplateName: m.accessTemplate?.name ?? null,
    joinedAt: m.createdAt,
  }));
}
