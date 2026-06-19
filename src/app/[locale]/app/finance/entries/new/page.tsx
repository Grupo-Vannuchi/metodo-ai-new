import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { financeFormOptions } from "@/lib/queries/finance";
import { EntryForm, type EntryDefaults } from "@/components/finance/entry-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewEntryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("finance");
  const options = await financeFormOptions(ctx.organizationId);

  const defaults: EntryDefaults = {
    type: "INCOME",
    description: "",
    amount: 0,
    status: "PENDING",
    dueDate: new Date().toISOString().slice(0, 10),
    settledAt: "",
    method: "",
    categoryId: "",
    contactId: "",
    companyId: "",
    opportunityId: "",
    notes: "",
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("newEntry")}</h1>
      <EntryForm mode="create" defaults={defaults} options={options} />
    </div>
  );
}
