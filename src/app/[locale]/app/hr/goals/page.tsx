import { getTranslations } from "next-intl/server";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { getGoals, currentMonth } from "@/lib/queries/goals";
import { GoalsClient } from "@/components/crm/goals-client";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/** Sales targets, under People (HR) — managed by the gestor (OWNER/ADMIN). */
export default async function HrGoalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.goals");

  const raw = (await searchParams)?.month;
  const month = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : currentMonth();
  const rows = await getGoals(ctx.organizationId, month);
  const canEdit = hasRole(ctx.role, "ADMIN");

  const label = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleDateString(
    locale === "pt" ? "pt-BR" : "en-US",
    { month: "long", year: "numeric" },
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle", { month: label })}</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <GoalsClient rows={rows} month={month} canEdit={canEdit} locale={locale} />
      )}

      {!canEdit ? <p className="text-xs text-muted-foreground">{t("readOnly")}</p> : null}
    </div>
  );
}
