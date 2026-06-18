import { requireOrgContext } from "@/lib/tenant";
import { listFinanceEntries } from "@/lib/queries/finance";
import { EntriesTable } from "@/components/finance/entries-table";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EntriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const rows = await listFinanceEntries(ctx.organizationId);
  return <EntriesTable rows={rows} />;
}
