import { requireOrgContext } from "@/lib/tenant";
import { getCashflow } from "@/lib/queries/finance";
import { CashflowTable } from "@/components/finance/cashflow-table";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function CashflowPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const months = await getCashflow(ctx.organizationId, 6);
  return <CashflowTable months={months} />;
}
