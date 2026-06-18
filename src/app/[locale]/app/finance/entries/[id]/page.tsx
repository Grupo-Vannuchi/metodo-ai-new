import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getFinanceEntry, financeFormOptions } from "@/lib/queries/finance";
import { EntryForm, type EntryDefaults } from "@/components/finance/entry-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const dateStr = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export default async function EditEntryPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: raw, id } = await params;
  const locale = resolveLocale(raw);
  const ctx = await requireOrgContext(locale);

  const [entry, options] = await Promise.all([
    getFinanceEntry(ctx.organizationId, id),
    financeFormOptions(ctx.organizationId),
  ]);
  if (!entry) notFound();

  const defaults: EntryDefaults = {
    type: entry.type,
    description: entry.description,
    amount: entry.amount,
    status: entry.status,
    dueDate: dateStr(entry.dueDate),
    settledAt: dateStr(entry.settledAt),
    method: entry.method ?? "",
    categoryId: entry.categoryId ?? "",
    contactId: entry.contactId ?? "",
    companyId: entry.companyId ?? "",
    opportunityId: entry.opportunityId ?? "",
    notes: entry.notes ?? "",
  };

  return <EntryForm mode="edit" entryId={entry.id} defaults={defaults} options={options} />;
}
