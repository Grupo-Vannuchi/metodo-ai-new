import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getDre } from "@/lib/queries/finance";
import { companyOptions } from "@/lib/queries/companies";
import { contactOptions } from "@/lib/queries/contacts";
import { DreTable } from "@/components/finance/dre-table";
import { ClientFilter } from "@/components/finance/client-filter";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const ymKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export default async function DrePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string; contactId?: string; companyId?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const { month, contactId, companyId } = await searchParams;

  const base =
    month && /^\d{4}-\d{2}$/.test(month)
      ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
      : new Date();
  const from = new Date(base.getFullYear(), base.getMonth(), 1);
  const to = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const prev = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  const next = new Date(base.getFullYear(), base.getMonth() + 1, 1);

  const [dre, companies, contacts] = await Promise.all([
    getDre(ctx.organizationId, from, to, { contactId, companyId }),
    companyOptions(ctx.organizationId),
    contactOptions(ctx.organizationId),
  ]);
  const label = from.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  // Build the month-nav links preserving the client filter.
  const clientQs = contactId ? `&contactId=${contactId}` : companyId ? `&companyId=${companyId}` : "";
  const monthKeep: Record<string, string> = {};
  if (month) monthKeep.month = month;
  const value = contactId ? `c:${contactId}` : companyId ? `e:${companyId}` : "";

  const navCls = "rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link href={`/app/finance/dre?month=${ymKey(prev)}${clientQs}`} aria-label="prev" className={navCls}>
            <ChevronLeft className="size-4" />
          </Link>
          <span className="min-w-40 text-center font-medium capitalize">{label}</span>
          <Link href={`/app/finance/dre?month=${ymKey(next)}${clientQs}`} aria-label="next" className={navCls}>
            <ChevronRight className="size-4" />
          </Link>
        </div>
        <ClientFilter contacts={contacts} companies={companies} value={value} basePath="/app/finance/dre" keep={monthKeep} />
      </div>
      <DreTable dre={dre} />
    </div>
  );
}
