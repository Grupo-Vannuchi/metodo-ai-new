import { getTranslations } from "next-intl/server";
import { ArrowLeft, Target } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { hasRole } from "@/lib/tenant";
import { getGoals, currentMonth } from "@/lib/queries/goals";
import { GoalsClient } from "@/components/crm/goals-client";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function GoalsPage({
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/app/crm" className="text-muted-foreground transition-colors hover:text-foreground" aria-label={t("back")}>
              <ArrowLeft className="size-5" />
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Target className="size-6 text-brand" />
              {t("title")}
            </h1>
          </div>
          <p className="mt-1 text-muted-foreground">{t("subtitle", { month: label })}</p>
        </div>
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
