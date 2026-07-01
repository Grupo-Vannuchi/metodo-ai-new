import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { PlansGrid } from "@/components/marketing/plans-grid";
import { type PlanKey } from "@/config/plans";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/** In-app plans view (reached from Settings → "See plans"). Shows the plans
 * with the org's current plan marked; the BackBar returns to Settings. */
export default async function SettingsPlansPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("pricing");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <PlansGrid locale={locale} currentPlan={ctx.organization.plan as PlanKey} />

      <p className="text-sm text-muted-foreground">{t("changeNote")}</p>
    </div>
  );
}
