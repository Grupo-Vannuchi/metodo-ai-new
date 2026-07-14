import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { expenseCategories } from "@/lib/queries/payroll";
import { PayrollRunForm } from "@/components/hr/payroll-run-form";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
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
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("payroll.newTitle")}</h1>
        <Link href="/app/hr/payroll" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("back")}
        </Link>
      </div>
      <PayrollRunForm categories={categories} />
    </div>
  );
}
