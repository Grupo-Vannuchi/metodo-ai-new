import "server-only";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";

/**
 * Duplicate detection for the merge tool. Grouping is done in SQL (fast, on
 * normalized keys); the records are then fetched through `tenantDb` so the org
 * boundary is enforced the same way as everywhere else.
 *
 * A record can match on more than one key (same phone AND email). To avoid
 * showing it in two groups, phone/cnpj groups are built first and email/name
 * groups skip any id already grouped.
 */

export type DupRecord = {
  id: string;
  name: string;
  subtitle: string | null;
  detail: string | null;
  /** Linked deals — a hint for which record to keep as primary. */
  deals: number;
  createdAt: Date;
};

export type DupGroup = {
  key: string;
  reason: "phone" | "email" | "cnpj" | "name";
  records: DupRecord[];
};

type Group = { k: string; ids: string[] };

// ── Contacts ─────────────────────────────────────────────────────────────────

export async function findContactDuplicates(organizationId: string): Promise<DupGroup[]> {
  const phoneGroups = await prisma.$queryRaw<Group[]>`
    SELECT right(regexp_replace(phone, '\D', '', 'g'), 11) AS k, array_agg(id) AS ids
    FROM contacts
    WHERE "organizationId" = ${organizationId}
      AND phone IS NOT NULL
      AND length(regexp_replace(phone, '\D', '', 'g')) >= 8
    GROUP BY k HAVING count(*) > 1
    LIMIT 100`;
  const emailGroups = await prisma.$queryRaw<Group[]>`
    SELECT lower(trim(email)) AS k, array_agg(id) AS ids
    FROM contacts
    WHERE "organizationId" = ${organizationId}
      AND email IS NOT NULL AND trim(email) <> ''
    GROUP BY k HAVING count(*) > 1
    LIMIT 100`;

  const claimed = new Set<string>();
  const groups: { key: string; reason: "phone" | "email"; ids: string[] }[] = [];
  for (const g of phoneGroups) {
    groups.push({ key: g.k, reason: "phone", ids: g.ids });
    g.ids.forEach((id) => claimed.add(id));
  }
  for (const g of emailGroups) {
    const ids = g.ids.filter((id) => !claimed.has(id));
    if (ids.length > 1) {
      groups.push({ key: g.k, reason: "email", ids });
      ids.forEach((id) => claimed.add(id));
    }
  }
  if (groups.length === 0) return [];

  const db = tenantDb(organizationId);
  const rows = await db.contact.findMany({
    where: { id: { in: [...claimed] } },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      company: { select: { name: true } },
      _count: { select: { opportunities: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  return groups
    .map((g) => ({
      key: g.key,
      reason: g.reason,
      records: g.ids
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => ({
          id: r.id,
          name: r.name,
          subtitle: r.email || r.phone,
          detail: r.company?.name ?? null,
          deals: r._count.opportunities,
          createdAt: r.createdAt,
        })),
    }))
    .filter((g) => g.records.length > 1);
}

// ── Companies ────────────────────────────────────────────────────────────────

export async function findCompanyDuplicates(organizationId: string): Promise<DupGroup[]> {
  const cnpjGroups = await prisma.$queryRaw<Group[]>`
    SELECT regexp_replace(cnpj, '\D', '', 'g') AS k, array_agg(id) AS ids
    FROM companies
    WHERE "organizationId" = ${organizationId}
      AND cnpj IS NOT NULL
      AND length(regexp_replace(cnpj, '\D', '', 'g')) >= 8
    GROUP BY k HAVING count(*) > 1
    LIMIT 100`;
  const nameGroups = await prisma.$queryRaw<Group[]>`
    SELECT lower(trim(name)) AS k, array_agg(id) AS ids
    FROM companies
    WHERE "organizationId" = ${organizationId} AND trim(name) <> ''
    GROUP BY k HAVING count(*) > 1
    LIMIT 100`;

  const claimed = new Set<string>();
  const groups: { key: string; reason: "cnpj" | "name"; ids: string[] }[] = [];
  for (const g of cnpjGroups) {
    groups.push({ key: g.k, reason: "cnpj", ids: g.ids });
    g.ids.forEach((id) => claimed.add(id));
  }
  for (const g of nameGroups) {
    const ids = g.ids.filter((id) => !claimed.has(id));
    if (ids.length > 1) {
      groups.push({ key: g.k, reason: "name", ids });
      ids.forEach((id) => claimed.add(id));
    }
  }
  if (groups.length === 0) return [];

  const db = tenantDb(organizationId);
  const rows = await db.company.findMany({
    where: { id: { in: [...claimed] } },
    select: {
      id: true,
      name: true,
      cnpj: true,
      email: true,
      createdAt: true,
      _count: { select: { opportunities: true, contacts: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  return groups
    .map((g) => ({
      key: g.key,
      reason: g.reason,
      records: g.ids
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => ({
          id: r.id,
          name: r.name,
          subtitle: r.cnpj || r.email,
          detail: r._count.contacts ? `${r._count.contacts} contato(s)` : null,
          deals: r._count.opportunities,
          createdAt: r.createdAt,
        })),
    }))
    .filter((g) => g.records.length > 1);
}
