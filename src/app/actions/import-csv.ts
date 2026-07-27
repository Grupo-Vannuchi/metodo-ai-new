"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { formatBrPhone, brPhoneKey } from "@/lib/phone";
import { onlyDigits } from "@/lib/cnpj";
import { ensureContactFolder, ensureCompanyFolder, lazyFolder } from "@/lib/crm/import-folders";

/**
 * Bulk import from a spreadsheet (CSV). The client parses + column-maps the file
 * and posts an array of field-keyed rows; this validates leniently (a contact
 * list is messy — a missing/odd phone shouldn't reject the row) and files the
 * new records into their own folder, like the prospecting/WhatsApp imports.
 *
 * Deliberately NOT the strict form schema: that one requires a valid BR phone,
 * which would drop most real rows. Here name is the only hard requirement.
 */

const MAX_ROWS = 5000;
const dateTag = () => {
  const d = new Date();
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

export type ImportResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: "unauthorized" | "empty" | "too_many" | "unknown" };

const clean = (s: string | undefined, max = 200) => (s ?? "").toString().trim().slice(0, max);
const looksEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

type ContactRow = { name?: string; email?: string; phone?: string; role?: string; tags?: string; company?: string };

export async function importContactsCsv(rows: ContactRow[]): Promise<ImportResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "empty" };
  if (rows.length > MAX_ROWS) return { ok: false, error: "too_many" };

  try {
    const db = tenantDb(ctx.organizationId);
    const folder = lazyFolder(() =>
      ensureContactFolder(db, ctx.organizationId, `Importação CSV · ${dateTag()}`),
    );

    // Resolve company links by exact (case-insensitive) name — no new companies
    // are created here, an unmatched name just leaves the contact unlinked.
    const companyByName = new Map<string, string>();

    const seenPhone = new Set<string>();
    const seenEmail = new Set<string>();
    let created = 0;
    let skipped = 0;

    for (const raw of rows) {
      const name = clean(raw.name, 160);
      const email = clean(raw.email, 200).toLowerCase();
      const phoneRaw = clean(raw.phone, 40);
      const phoneKey = phoneRaw ? brPhoneKey(onlyDigits(phoneRaw)) : null;

      if (!name && !email && !phoneRaw) {
        skipped++;
        continue;
      }
      // In-batch dedupe on whichever identifier we have.
      if (phoneKey && seenPhone.has(phoneKey)) { skipped++; continue; }
      if (!phoneKey && email && seenEmail.has(email)) { skipped++; continue; }

      // Dedupe against existing contacts (phone first, then e-mail).
      let dupe = false;
      if (phoneKey) {
        const hit = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM contacts
          WHERE "organizationId" = ${ctx.organizationId}
            AND phone IS NOT NULL
            AND right(regexp_replace(phone, '\D', '', 'g'), 11) = ${phoneKey}
          LIMIT 1`;
        dupe = Boolean(hit[0]);
      } else if (email && looksEmail(email)) {
        dupe = Boolean(
          await db.contact.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } }),
        );
      }
      if (dupe) { skipped++; continue; }

      // Optional company link by name.
      let companyId: string | null = null;
      const companyName = clean(raw.company, 160);
      if (companyName) {
        const key = companyName.toLowerCase();
        if (companyByName.has(key)) {
          companyId = companyByName.get(key)!;
        } else {
          const co = await db.company.findFirst({
            where: { name: { equals: companyName, mode: "insensitive" } },
            select: { id: true },
          });
          if (co) {
            companyId = co.id;
            companyByName.set(key, co.id);
          }
        }
      }

      const tags = clean(raw.tags, 300)
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);

      await db.contact.create({
        data: {
          organizationId: ctx.organizationId,
          name: name || formatBrPhone(phoneRaw) || email || "Contato",
          email: email && looksEmail(email) ? email : null,
          phone: phoneRaw ? formatBrPhone(onlyDigits(phoneRaw)) || phoneRaw : null,
          role: clean(raw.role, 120) || null,
          companyId,
          tags: tags.length ? tags : ["importação"],
          source: "csv-import",
          folderId: await folder(),
        },
      });
      if (phoneKey) seenPhone.add(phoneKey);
      if (email) seenEmail.add(email);
      created++;
    }

    revalidatePath("/app/contacts");
    return { ok: true, created, skipped };
  } catch (error) {
    console.error("Failed to import contacts CSV", error);
    return { ok: false, error: "unknown" };
  }
}

type CompanyRow = {
  name?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
  website?: string;
  city?: string;
  uf?: string;
  notes?: string;
};

export async function importCompaniesCsv(rows: CompanyRow[]): Promise<ImportResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "empty" };
  if (rows.length > MAX_ROWS) return { ok: false, error: "too_many" };

  try {
    const db = tenantDb(ctx.organizationId);
    const folder = lazyFolder(() =>
      ensureCompanyFolder(db, ctx.organizationId, `Importação CSV · ${dateTag()}`),
    );

    const seenCnpj = new Set<string>();
    const seenName = new Set<string>();
    let created = 0;
    let skipped = 0;

    for (const raw of rows) {
      const name = clean(raw.name, 160);
      const cnpjDigits = onlyDigits(clean(raw.cnpj, 20));
      if (!name && !cnpjDigits) { skipped++; continue; }

      // Dedupe by CNPJ when present, otherwise by name.
      if (cnpjDigits) {
        if (seenCnpj.has(cnpjDigits)) { skipped++; continue; }
        const hit = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM companies
          WHERE "organizationId" = ${ctx.organizationId}
            AND cnpj IS NOT NULL
            AND regexp_replace(cnpj, '\D', '', 'g') = ${cnpjDigits}
          LIMIT 1`;
        if (hit[0]) { skipped++; continue; }
      } else {
        const key = name.toLowerCase();
        if (seenName.has(key)) { skipped++; continue; }
        const exists = await db.company.findFirst({
          where: { name: { equals: name, mode: "insensitive" } },
          select: { id: true },
        });
        if (exists) { skipped++; continue; }
      }

      const website = clean(raw.website, 300);
      const uf = clean(raw.uf, 2).toUpperCase();
      const city = clean(raw.city, 120);
      const email = clean(raw.email, 200).toLowerCase();

      await db.company.create({
        data: {
          organizationId: ctx.organizationId,
          name: name || `CNPJ ${cnpjDigits}`,
          cnpj: clean(raw.cnpj, 20) || null,
          email: email && looksEmail(email) ? email : null,
          phone: clean(raw.phone, 40) || null,
          website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
          address: city || uf ? { city, state: uf } : {},
          notes: clean(raw.notes, 2000) || null,
          source: "csv-import",
          folderId: await folder(),
        },
      });
      if (cnpjDigits) seenCnpj.add(cnpjDigits);
      else seenName.add(name.toLowerCase());
      created++;
    }

    revalidatePath("/app/companies");
    return { ok: true, created, skipped };
  } catch (error) {
    console.error("Failed to import companies CSV", error);
    return { ok: false, error: "unknown" };
  }
}
