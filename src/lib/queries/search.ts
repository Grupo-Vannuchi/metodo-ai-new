import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { formatBrPhone } from "@/lib/phone";
import { formatBRL } from "@/lib/money";

export type SearchType = "contact" | "company" | "opportunity" | "conversation" | "finance";

export type SearchResult = {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

const PER_TYPE = 5;

/** Global search across the CRM, inbox and finance — org-scoped, gated by the
 * member's screen access. Used by the ⌘K command palette. */
export async function globalSearch(
  organizationId: string,
  query: string,
  opts: { allowed: (screen: string) => boolean; canFinance: boolean },
): Promise<SearchResult[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const db = tenantDb(organizationId);
  const c = { contains: term, mode: "insensitive" as const };

  const [contacts, companies, opps, convos, entries] = await Promise.all([
    opts.allowed("contacts")
      ? db.contact.findMany({
          where: { OR: [{ name: c }, { email: c }, { phone: c }] },
          take: PER_TYPE,
          select: { id: true, name: true, email: true },
        })
      : [],
    opts.allowed("companies")
      ? db.company.findMany({
          where: { OR: [{ name: c }, { cnpj: c }] },
          take: PER_TYPE,
          select: { id: true, name: true, cnpj: true },
        })
      : [],
    opts.allowed("crm")
      ? db.opportunity.findMany({
          where: { OR: [{ title: c }, { code: c }] },
          orderBy: { createdAt: "desc" },
          take: PER_TYPE,
          select: { id: true, title: true, code: true },
        })
      : [],
    opts.allowed("inbox")
      ? db.conversation.findMany({
          where: { OR: [{ name: c }, { customName: c }, { remoteJid: c }] },
          take: PER_TYPE,
          select: { id: true, name: true, customName: true, remoteJid: true },
        })
      : [],
    opts.canFinance
      ? db.financeEntry.findMany({
          where: { description: c },
          orderBy: { dueDate: "desc" },
          take: PER_TYPE,
          select: { id: true, description: true, amount: true },
        })
      : [],
  ]);

  const results: SearchResult[] = [];
  for (const x of contacts) results.push({ type: "contact", id: x.id, title: x.name, subtitle: x.email, href: `/app/contacts/${x.id}` });
  for (const x of companies) results.push({ type: "company", id: x.id, title: x.name, subtitle: x.cnpj, href: `/app/companies/${x.id}` });
  for (const x of opps) results.push({ type: "opportunity", id: x.id, title: x.title, subtitle: x.code, href: `/app/crm/${x.id}` });
  for (const x of convos) {
    const digits = x.remoteJid.split("@")[0] ?? "";
    results.push({
      type: "conversation",
      id: x.id,
      title: x.customName || x.name || formatBrPhone(digits) || digits,
      subtitle: null,
      href: `/app/inbox?c=${x.id}`,
    });
  }
  for (const x of entries)
    results.push({ type: "finance", id: x.id, title: x.description, subtitle: formatBRL(Number(x.amount)), href: `/app/finance/entries/${x.id}` });

  return results;
}
