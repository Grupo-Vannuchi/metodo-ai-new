import { getTranslations } from "next-intl/server";
import { Trophy, Percent, Ticket, Clock, TrendingDown, ArrowLeft } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getSalesReport, type SalesPeriod } from "@/lib/queries/sales-report";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PERIODS: SalesPeriod[] = ["30D", "MONTH", "YEAR", "ALL"];

export default async function SalesReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.reports");

  const raw = (await searchParams)?.period;
  const period = (PERIODS.includes(raw as SalesPeriod) ? raw : "MONTH") as SalesPeriod;
  const r = await getSalesReport(ctx.organizationId, period);

  const brl = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const maxFunnel = Math.max(1, ...r.funnel.map((s) => s.value));
  const maxReason = Math.max(1, ...r.lossReasons.map((l) => l.count));

  const kpis = [
    { icon: Percent, label: t("winRate"), value: pct(r.winRate), hint: t("wonLost", { won: r.won, lost: r.lost }) },
    { icon: Trophy, label: t("wonValue"), value: brl.format(r.wonValue) },
    { icon: Ticket, label: t("avgTicket"), value: brl.format(r.avgTicket) },
    {
      icon: Clock,
      label: t("avgCycle"),
      value: r.avgCycleDays === null ? "—" : t("days", { n: r.avgCycleDays }),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/app/crm" className="text-muted-foreground transition-colors hover:text-foreground" aria-label={t("back")}>
              <ArrowLeft className="size-5" />
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          </div>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        {/* Period selector. */}
        <div className="flex items-center rounded-lg border border-border p-0.5">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/app/crm/reports?period=${p}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                period === p ? "bg-brand text-brand-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`period.${p}`)}
            </Link>
          ))}
        </div>
      </div>

      <section className="stagger-children grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="hover-lift glass rounded-xl border border-border p-5 shadow-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <k.icon className="size-4" />
              <span className="text-sm">{k.label}</span>
            </div>
            <p className="mt-2 text-2xl font-bold">{k.value}</p>
            {k.hint ? <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p> : null}
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Current open funnel by stage. */}
        <section className="glass rounded-xl border border-border p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold">{t("funnelTitle")}</h2>
          {r.funnel.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {r.funnel.map((s) => (
                <li key={s.id} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-sm">{s.name}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted">
                    <div
                      className="flex h-full items-center rounded-md bg-brand/80 px-2"
                      style={{ width: `${Math.max(6, (s.value / maxFunnel) * 100)}%` }}
                    >
                      <span className="truncate text-xs font-medium text-brand-foreground">{brl.format(s.value)}</span>
                    </div>
                  </div>
                  <span className="w-8 shrink-0 text-right text-sm text-muted-foreground">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Loss reasons. */}
        <section className="glass rounded-xl border border-border p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <TrendingDown className="size-4 text-red-500" />
            <h2 className="text-sm font-semibold">{t("lossReasonsTitle")}</h2>
          </div>
          {r.lossReasons.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("noReasons")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {r.lossReasons.map((l) => (
                <li key={l.reason} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm" title={l.reason}>{l.reason}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded-md bg-muted">
                    <div className="h-full rounded-md bg-red-500/70" style={{ width: `${Math.max(6, (l.count / maxReason) * 100)}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-sm text-muted-foreground">{l.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
