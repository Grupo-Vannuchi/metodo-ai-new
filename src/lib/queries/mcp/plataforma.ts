import "server-only";
import type { Prisma } from "@prisma/client";
import type { OrgRef } from "@/lib/mcp/tool";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";

/**
 * Platform-level reads of the MCP server (docs/guia/03-multi-tenancy.md):
 * system context, so `Organization`, `Membership` and `User` (global models)
 * go through the raw client with explicit ids, and business tables through
 * `tenantDb(organizationId)`.
 */

/** id + name of an organization, or null — how every org-scoped tool checks its argument. */
export async function getOrganizationRef(id: string): Promise<OrgRef | null> {
  return prisma.organization.findFirst({ where: { id }, select: { id: true, name: true } });
}

export type OrgListItem = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  onboardedAt: Date | null;
  owner: { id: string; name: string; email: string } | null;
  memberCount: number;
  modules: { moduleId: string; status: "ACTIVE" | "DORMANT" }[];
};

export async function listOrganizations(o: {
  search?: string;
  take: number;
  skip: number;
}): Promise<{ total: number; items: OrgListItem[] }> {
  const where: Prisma.OrganizationWhereInput = o.search
    ? {
        OR: [
          { name: { contains: o.search, mode: "insensitive" } },
          { slug: { contains: o.search, mode: "insensitive" } },
        ],
      }
    : {};
  const [total, orgs] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: { name: "asc" },
      take: o.take,
      skip: o.skip,
      select: {
        id: true,
        name: true,
        slug: true,
        ownerId: true,
        createdAt: true,
        onboardedAt: true,
        _count: { select: { memberships: true } },
        modules: { select: { moduleId: true, status: true }, orderBy: { moduleId: "asc" } },
      },
    }),
  ]);

  // `Organization.ownerId` is a bare scalar (no relation), so owners come in one extra read.
  const ownerIds = [...new Set(orgs.map((org) => org.ownerId).filter((id): id is string => Boolean(id)))];
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const ownerOf = new Map(owners.map((u) => [u.id, u]));

  return {
    total,
    items: orgs.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      createdAt: org.createdAt,
      onboardedAt: org.onboardedAt,
      owner: org.ownerId ? (ownerOf.get(org.ownerId) ?? null) : null,
      memberCount: org._count.memberships,
      modules: org.modules,
    })),
  };
}

export async function listMembers(organizationId: string): Promise<
  { userId: string; name: string; email: string; role: "OWNER" | "ADMIN" | "MEMBER"; createdAt: Date }[]
> {
  const rows = await prisma.membership.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
  });
  return rows.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    createdAt: m.createdAt,
  }));
}

/** Module states and record counts per module — the "what's in this company" overview. */
export async function organizationSummary(organizationId: string) {
  const db = tenantDb(organizationId);
  const [
    modules,
    members,
    companies,
    contacts,
    opportunitiesOpen,
    proposals,
    financeEntries,
    employeesActive,
    supplyItems,
    purchaseOrdersOpen,
    assets,
    tasksOpen,
    campaigns,
    emailBroadcasts,
    conversations,
    extractionJobs,
    extractedLeads,
    importedLeads,
  ] = await Promise.all([
    db.organizationModule.findMany({
      select: { moduleId: true, status: true },
      orderBy: { moduleId: "asc" },
    }),
    prisma.membership.count({ where: { organizationId } }),
    db.company.count({}),
    db.contact.count({}),
    db.opportunity.count({ where: { status: "OPEN" } }),
    db.proposal.count({}),
    // Payroll entries are never counted or listed one by one (spec 2026-10-22).
    db.financeEntry.count({ where: { employeeId: null, payrollRunId: null } }),
    db.employee.count({ where: { status: "ACTIVE" } }),
    db.supplyItem.count({}),
    db.purchaseOrder.count({ where: { status: { in: ["DRAFT", "APPROVED", "ORDERED", "PARTIAL"] } } }),
    db.asset.count({}),
    db.task.count({ where: { doneAt: null } }),
    db.campaign.count({}),
    db.emailBroadcast.count({}),
    db.conversation.count({}),
    db.extractionJob.count({}),
    db.extractedLead.count({}),
    db.extractedLead.count({ where: { importedAt: { not: null } } }),
  ]);
  return {
    modules,
    counts: {
      members,
      companies,
      contacts,
      opportunitiesOpen,
      proposals,
      financeEntries,
      employeesActive,
      supplyItems,
      purchaseOrdersOpen,
      assets,
      tasksOpen,
      campaigns,
      emailBroadcasts,
      conversations,
      extractionJobs,
      extractedLeads,
      importedLeads,
    },
  };
}
