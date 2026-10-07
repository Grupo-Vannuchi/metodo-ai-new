import "server-only";
import type { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { normalizeEmail } from "./normalize";
import { mergeCandidates, type Candidate } from "./audience-core";
import type { AudienceSelection } from "@/lib/validations/email-broadcast";

/** Only rows whose e-mail at least looks like an address (skips null and ""). */
const HAS_EMAIL = { contains: "@" } as const;

/**
 * Resolve a selection into unique, sendable recipients. Contacts and companies
 * match ANY selected criterion (union). Blocked = the org's EmailSuppression
 * plus the e-mails of contacts with optedOut = true (read-only: this module
 * never writes Contact.optedOut).
 */
export async function resolveAudience(organizationId: string, sel: AudienceSelection) {
  const db = tenantDb(organizationId);

  const contactOr: Prisma.ContactWhereInput[] = [];
  if (sel.contactTags.length) contactOr.push({ tags: { hasSome: sel.contactTags } });
  if (sel.contactFolderIds.length) contactOr.push({ folderId: { in: sel.contactFolderIds } });
  if (sel.contactIds.length) contactOr.push({ id: { in: sel.contactIds } });
  const wantContacts = sel.allContacts || contactOr.length > 0;

  const companyOr: Prisma.CompanyWhereInput[] = [];
  if (sel.companyFolderIds.length) companyOr.push({ folderId: { in: sel.companyFolderIds } });
  if (sel.companyIds.length) companyOr.push({ id: { in: sel.companyIds } });
  const wantCompanies = sel.allCompanies || companyOr.length > 0;

  const [contacts, companies, suppressed, optedOut] = await Promise.all([
    wantContacts
      ? db.contact.findMany({
          where: sel.allContacts ? { email: HAS_EMAIL } : { email: HAS_EMAIL, OR: contactOr },
          select: { id: true, name: true, email: true, company: { select: { name: true } } },
        })
      : Promise.resolve([]),
    wantCompanies
      ? db.company.findMany({
          where: sel.allCompanies ? { email: HAS_EMAIL } : { email: HAS_EMAIL, OR: companyOr },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    db.emailSuppression.findMany({ select: { email: true } }),
    db.contact.findMany({ where: { optedOut: true, email: HAS_EMAIL }, select: { email: true } }),
  ]);

  const candidates: Candidate[] = [
    ...contacts.map((c) => ({
      email: c.email ?? "",
      source: "contact" as const,
      name: c.name,
      companyName: c.company?.name ?? null,
      contactId: c.id,
    })),
    ...companies.map((c) => ({
      email: c.email ?? "",
      source: "company" as const,
      name: c.name,
      companyName: c.name,
      companyId: c.id,
    })),
    ...sel.emails.map((email) => ({ email, source: "manual" as const })),
  ];

  const blocked = new Set<string>([
    ...suppressed.map((s) => s.email),
    ...optedOut.map((c) => normalizeEmail(c.email ?? "")),
  ]);

  return mergeCandidates(candidates, blocked);
}
