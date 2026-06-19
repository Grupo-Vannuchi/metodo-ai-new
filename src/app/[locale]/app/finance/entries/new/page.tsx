import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { financeFormOptions } from "@/lib/queries/finance";
import { EntryForm, type EntryDefaults } from "@/components/finance/entry-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

type Prefill = {
  type?: string;
  description?: string;
  amount?: string;
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
  dueDate?: string;
};

export default async function NewEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Prefill>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("finance");
  const options = await financeFormOptions(ctx.organizationId);
  const q = await searchParams;

  // Pre-fill (e.g. when converting a won opportunity into a finance entry).
  const defaults: EntryDefaults = {
    type: q.type === "EXPENSE" ? "EXPENSE" : "INCOME",
    description: q.description ?? "",
    amount: q.amount ? Number(q.amount) || 0 : 0,
    status: "PENDING",
    dueDate: q.dueDate || new Date().toISOString().slice(0, 10),
    settledAt: "",
    method: "",
    categoryId: "",
    contactId: q.contactId ?? "",
    companyId: q.companyId ?? "",
    opportunityId: q.opportunityId ?? "",
    notes: "",
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("newEntry")}</h1>
      <EntryForm mode="create" defaults={defaults} options={options} />
    </div>
  );
}
