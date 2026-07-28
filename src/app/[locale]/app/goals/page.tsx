import { getTranslations } from "next-intl/server";
import { Target, Trophy, TrendingUp, Percent } from "lucide-react";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { getGoals, currentMonth } from "@/lib/queries/goals";
import { GoalsClient } from "@/components/crm/goals-client";
import { GoalsMonthNav } from "@/components/crm/goals-month-nav";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/** Sales targets — its own page, managed by the gestor (OWNER/ADMIN). */
export default async function GoalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "crm", locale);
  const t = await getTranslations("crm.goals");

  const raw = (await searchParams)?.month;
  const month = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : currentMonth();
  const rows = await getGoals(ctx.organizationId, month);
  const canEdit = hasRole(ctx.role, "ADMIN");

  const brl = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const label = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleDateString(
    locale === "pt" ? "pt-BR" : "en-US",
    { month: "long", year: "numeric" },
  );

  // Team roll-up.
  const totalTarget = rows.reduce((a, r) => a + r.target, 0);
  const totalAchieved = rows.reduce((a, r) => a + r.achieved, 0);
  const attainment = totalTarget > 0 ? Math.round((totalAchieved / totalTarget) * 100) : 0;

  const kpis = [
    { icon: Target, label: t("teamTarget"), value: brl.format(totalTarget) },
    { icon: Trophy, label: t("teamAchieved"), value: brl.format(totalAchieved) },
    { icon: Percent, label: t("attainment"), value: totalTarget > 0 ? `${attainment}%` : "—" },
    { icon: TrendingUp, label: t("gap"), value: brl.format(Math.max(0, totalTarget - totalAchieved)) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle", { month: label })}</p>
        </div>
        <GoalsMonthNav month={month} label={label} />
      </div>

      <section className="stagger-children grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="hover-lift glass rounded-xl border border-border p-5 shadow-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <k.icon className="size-4" />
              <span className="text-sm">{k.label}</span>
            </div>
            <p className="mt-2 text-2xl font-bold">{k.value}</p>
          </div>
        ))}
      </section>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <GoalsClient rows={rows} month={month} canEdit={canEdit} locale={locale} />
      )}

      {!canEdit ? <p className="text-xs text-muted-foreground">{t("readOnly")}</p> : null}
    </div>
  );
}
