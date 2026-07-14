import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { expenseCategories } from "@/lib/queries/payroll";
import { PayrollRunForm } from "@/components/hr/payroll-run-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewPayrollRunPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("hr");

  const categories = await expenseCategories(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("payroll.newTitle")}</h1>
      <PayrollRunForm categories={categories} />
    </div>
  );
}
