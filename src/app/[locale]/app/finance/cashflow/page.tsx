import { requireOrgContext } from "@/lib/tenant";
import { getCashflow } from "@/lib/queries/finance";
import { companyOptions } from "@/lib/queries/companies";
import { contactOptions } from "@/lib/queries/contacts";
import { CashflowTable } from "@/components/finance/cashflow-table";
import { ClientFilter } from "@/components/finance/client-filter";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function CashflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ contactId?: string; companyId?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const { contactId, companyId } = await searchParams;

  const [months, companies, contacts] = await Promise.all([
    getCashflow(ctx.organizationId, 6, { contactId, companyId }),
    companyOptions(ctx.organizationId),
    contactOptions(ctx.organizationId),
  ]);

  const value = contactId ? `c:${contactId}` : companyId ? `e:${companyId}` : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <ClientFilter contacts={contacts} companies={companies} value={value} basePath="/app/finance/cashflow" />
      </div>
      <CashflowTable months={months} />
    </div>
  );
}
