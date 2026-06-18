import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getFinanceSummary } from "@/lib/queries/finance";
import { formatBRL } from "@/lib/money";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function FinanceOverview({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("finance");
  const s = await getFinanceSummary(ctx.organizationId);

  const cards = [
    { label: t("kpi.receivable"), value: s.receivable, tone: "text-green-600" },
    { label: t("kpi.payable"), value: s.payable, tone: "text-red-600" },
    { label: t("kpi.balance"), value: s.balance, tone: s.balance >= 0 ? "text-foreground" : "text-red-600" },
    { label: t("kpi.monthResult"), value: s.monthResult, tone: s.monthResult >= 0 ? "text-green-600" : "text-red-600" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">{c.label}</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", c.tone)}>{formatBRL(c.value)}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">{t("thisMonth")}</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{t("nav.income")}</p>
            <p className="mt-0.5 font-semibold text-green-600">{formatBRL(s.monthIncome)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("nav.expense")}</p>
            <p className="mt-0.5 font-semibold text-red-600">{formatBRL(s.monthExpense)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("dre.result")}</p>
            <p className={cn("mt-0.5 font-semibold", s.monthResult >= 0 ? "text-green-600" : "text-red-600")}>
              {formatBRL(s.monthResult)}
            </p>
          </div>
        </div>
      </section>

      <div>
        <Link href="/app/finance/entries/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("newEntry")}
        </Link>
      </div>
    </div>
  );
}
