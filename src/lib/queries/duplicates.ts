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
 *
 * Digits are cleaned with `[^0-9]`. Until 18/11/2026 these two queries used a
 * backslash-D, which `$queryRaw` (cooked template) sent as `'D'`: phones and
 * CNPJs only grouped when typed exactly alike. See findCompanyMatches below.
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
    SELECT right(regexp_replace(phone, '[^0-9]', '', 'g'), 11) AS k, array_agg(id) AS ids
    FROM contacts
    WHERE "organizationId" = ${organizationId}
      AND phone IS NOT NULL
      AND length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 8
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
    SELECT regexp_replace(cnpj, '[^0-9]', '', 'g') AS k, array_agg(id) AS ids
    FROM companies
    WHERE "organizationId" = ${organizationId}
      AND cnpj IS NOT NULL
      AND length(regexp_replace(cnpj, '[^0-9]', '', 'g')) >= 8
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

// ── Before creating one (quick add in "Nova oportunidade") ───────────────────

/** An existing record that looks like the one about to be created. */
export type MatchRecord = {
  id: string;
  name: string;
  reason: "cnpj" | "name" | "phone" | "email";
  /** CNPJ, phone or e-mail, to tell homonyms apart. */
  detail: string | null;
};

const MATCH_LIMIT = 3;

/**
 * Companies of this org with the same CNPJ (digits only, any formatting) or the
 * same name (case and outer spaces ignored) — the keys the merge tool uses.
 * Ids come from SQL with the org written by hand (the digit normalization has
 * no Prisma equivalent); the rows are then read through `tenantDb`. The class
 * is `[^0-9]`, never `\D`: `$queryRaw` takes the cooked template, where a
 * backslash-D reaches Postgres as a plain `'D'` and strips nothing (checked on
 * 18/11/2026).
 */
export async function findCompanyMatches(
  organizationId: string,
  input: { name: string; cnpj?: string },
): Promise<MatchRecord[]> {
  const digits = (input.cnpj ?? "").replace(/\D/g, "");
  const name = input.name.trim().toLowerCase();
  const reasons = new Map<string, MatchRecord["reason"]>();
  if (digits.length >= 8) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM companies
      WHERE "organizationId" = ${organizationId}
        AND cnpj IS NOT NULL
        AND regexp_replace(cnpj, '[^0-9]', '', 'g') = ${digits}
      LIMIT ${MATCH_LIMIT}`;
    rows.forEach((r) => reasons.set(r.id, "cnpj"));
  }
  if (name) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM companies
      WHERE "organizationId" = ${organizationId}
        AND lower(trim(name)) = ${name}
      LIMIT ${MATCH_LIMIT}`;
    rows.forEach((r) => { if (!reasons.has(r.id)) reasons.set(r.id, "name"); });
  }
  if (reasons.size === 0) return [];
  const records = await tenantDb(organizationId).company.findMany({
    where: { id: { in: [...reasons.keys()] } },
    select: { id: true, name: true, cnpj: true },
  });
  return records
    .map((r) => ({ id: r.id, name: r.name, reason: reasons.get(r.id)!, detail: r.cnpj }))
    .sort((a, b) => (a.reason === "cnpj" ? 0 : 1) - (b.reason === "cnpj" ? 0 : 1))
    .slice(0, MATCH_LIMIT);
}

/**
 * Contacts of this org with the same phone (last 11 digits, any formatting) or
 * the same e-mail (case and outer spaces ignored) — the merge tool's keys. Name
 * alone is not a match: homonyms are common among contacts.
 */
export async function findContactMatches(
  organizationId: string,
  input: { phone?: string; email?: string },
): Promise<MatchRecord[]> {
  const digits = (input.phone ?? "").replace(/\D/g, "").slice(-11);
  const email = (input.email ?? "").trim().toLowerCase();
  const reasons = new Map<string, MatchRecord["reason"]>();
  if (digits.length >= 8) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM contacts
      WHERE "organizationId" = ${organizationId}
        AND phone IS NOT NULL
        AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 11) = ${digits}
      LIMIT ${MATCH_LIMIT}`;
    rows.forEach((r) => reasons.set(r.id, "phone"));
  }
  if (email) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM contacts
      WHERE "organizationId" = ${organizationId}
        AND email IS NOT NULL
        AND lower(trim(email)) = ${email}
      LIMIT ${MATCH_LIMIT}`;
    rows.forEach((r) => { if (!reasons.has(r.id)) reasons.set(r.id, "email"); });
  }
  if (reasons.size === 0) return [];
  const records = await tenantDb(organizationId).contact.findMany({
    where: { id: { in: [...reasons.keys()] } },
    select: { id: true, name: true, phone: true, email: true },
  });
  return records
    .map((r) => {
      const reason = reasons.get(r.id)!;
      return { id: r.id, name: r.name, reason, detail: reason === "phone" ? r.phone : r.email };
    })
    .sort((a, b) => (a.reason === "phone" ? 0 : 1) - (b.reason === "phone" ? 0 : 1))
    .slice(0, MATCH_LIMIT);
}
