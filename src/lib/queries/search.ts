import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { formatBrPhone } from "@/lib/phone";
import { formatBRL } from "@/lib/money";
import { WHATSAPP_PROVIDERS } from "@/lib/queries/connections";

export type SearchType = "contact" | "company" | "opportunity" | "conversation" | "finance";

export type SearchResult = {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string | null;
  /** Extra identifying details (phone, company, value, stage…) shown as chips,
   * so a hit is recognizable without opening it. */
  meta: string[];
  href: string;
};

const PER_TYPE = 5;

type Addr = { city?: string; state?: string };

const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : null);

/** Drop empty/duplicate details and cap the row so it stays one line. */
const details = (...parts: (string | null | undefined)[]): string[] =>
  [...new Set(parts.map((p) => p?.toString().trim()).filter((p): p is string => Boolean(p)))].slice(0, 4);

/** Global search across the CRM, inbox and finance — org-scoped, gated by the
 * member's screen access. Used by the ⌘K command palette. */
export async function globalSearch(
  organizationId: string,
  query: string,
  opts: {
    allowed: (screen: string) => boolean;
    canFinance: boolean;
    viewer: { userId: string; role: string };
  },
): Promise<SearchResult[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const db = tenantDb(organizationId);
  const c = { contains: term, mode: "insensitive" as const };

  // Inbox results are strictly scoped to the viewer's OWN numbers — every role,
  // admins included, so one user's chats never surface in another's search.
  const convoConnIds = (
    await db.integrationConnection.findMany({
      where: { ownerId: opts.viewer.userId, provider: { in: [...WHATSAPP_PROVIDERS] } },
      select: { id: true },
    })
  ).map((x) => x.id);
  const canSearchInbox = opts.allowed("inbox") && convoConnIds.length !== 0;
  const convoBase = { OR: [{ name: c }, { customName: c }, { remoteJid: c }] };
  const convoWhere = { AND: [{ connectionId: { in: convoConnIds } }, convoBase] };

  const [contacts, companies, opps, convos, entries] = await Promise.all([
    opts.allowed("contacts")
      ? db.contact.findMany({
          where: { OR: [{ name: c }, { email: c }, { phone: c }] },
          take: PER_TYPE,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            company: { select: { name: true } },
          },
        })
      : [],
    opts.allowed("companies")
      ? db.company.findMany({
          where: { OR: [{ name: c }, { cnpj: c }] },
          take: PER_TYPE,
          select: { id: true, name: true, cnpj: true, phone: true, email: true, address: true },
        })
      : [],
    opts.allowed("crm")
      ? db.opportunity.findMany({
          where: { OR: [{ title: c }, { code: c }] },
          orderBy: { createdAt: "desc" },
          take: PER_TYPE,
          select: {
            id: true,
            title: true,
            code: true,
            value: true,
            stage: { select: { name: true } },
            company: { select: { name: true } },
          },
        })
      : [],
    canSearchInbox
      ? db.conversation.findMany({
          where: convoWhere,
          take: PER_TYPE,
          select: {
            id: true,
            name: true,
            customName: true,
            remoteJid: true,
            isGroup: true,
            lastMessageAt: true,
            lastMessagePreview: true,
          },
        })
      : [],
    opts.canFinance
      ? db.financeEntry.findMany({
          where: { description: c },
          orderBy: { dueDate: "desc" },
          take: PER_TYPE,
          select: {
            id: true,
            description: true,
            amount: true,
            dueDate: true,
            category: { select: { name: true } },
          },
        })
      : [],
  ]);

  const results: SearchResult[] = [];
  for (const x of contacts)
    results.push({
      type: "contact",
      id: x.id,
      title: x.name,
      subtitle: x.email,
      meta: details(x.phone ? formatBrPhone(x.phone) || x.phone : null, x.company?.name, x.role),
      href: `/app/contacts/${x.id}`,
    });
  for (const x of companies) {
    const addr = x.address as Addr | null;
    results.push({
      type: "company",
      id: x.id,
      title: x.name,
      subtitle: x.cnpj,
      meta: details(
        [addr?.city, addr?.state].filter(Boolean).join(" - "),
        x.phone ? formatBrPhone(x.phone) || x.phone : null,
        x.email,
      ),
      href: `/app/companies/${x.id}`,
    });
  }
  for (const x of opps)
    results.push({
      type: "opportunity",
      id: x.id,
      title: x.title,
      subtitle: x.code,
      meta: details(formatBRL(Number(x.value)), x.stage?.name, x.company?.name),
      href: `/app/crm/${x.id}`,
    });
  for (const x of convos) {
    const digits = x.remoteJid.split("@")[0] ?? "";
    const phone = formatBrPhone(digits) || digits;
    const named = Boolean(x.customName || x.name);
    results.push({
      type: "conversation",
      id: x.id,
      title: x.customName || x.name || phone,
      subtitle: x.lastMessagePreview,
      // Only repeat the number when it isn't already the title.
      meta: details(x.isGroup ? "Grupo" : named ? phone : null, fmtDate(x.lastMessageAt)),
      href: `/app/inbox?c=${x.id}`,
    });
  }
  for (const x of entries)
    results.push({
      type: "finance",
      id: x.id,
      title: x.description,
      subtitle: formatBRL(Number(x.amount)),
      meta: details(fmtDate(x.dueDate), x.category?.name),
      href: `/app/finance/entries/${x.id}`,
    });

  return results;
}
