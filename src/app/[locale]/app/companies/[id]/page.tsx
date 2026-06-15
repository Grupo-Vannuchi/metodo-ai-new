import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getCompany } from "@/lib/queries/companies";
import { CompanyForm } from "@/components/crm/company-form";
import { companyToForm } from "@/lib/company-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.companies");

  const company = await getCompany(ctx.organizationId, id);
  if (!company) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("editTitle")}</h1>
      <CompanyForm
        mode="edit"
        companyId={company.id}
        defaultValues={companyToForm(company)}
      />
    </div>
  );
}
