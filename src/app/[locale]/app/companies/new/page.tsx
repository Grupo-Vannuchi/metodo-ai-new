import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { CompanyForm } from "@/components/crm/company-form";
import { emptyCompanyForm } from "@/lib/company-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  await requireOrgContext(locale);
  const t = await getTranslations("crm.companies");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
      <CompanyForm mode="create" defaultValues={emptyCompanyForm()} />
    </div>
  );
}
