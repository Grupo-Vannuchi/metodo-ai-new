import { getTranslations } from "next-intl/server";
import {
  TrendingUp,
  CircleDollarSign,
  Target,
  Trophy,
  Building2,
  Contact,
  Send,
  ArrowRight,
} from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getDashboardInsights } from "@/lib/queries/insights";
import { getSalesReport } from "@/lib/queries/sales-report";
import { PIE_MODELS, PIE_FINANCE_MODELS } from "@/lib/queries/dashboard";
import { hasFeature, type PlanKey } from "@/config/plans";
import { PieCard } from "@/components/dashboard/pie-card";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("app.dashboard");
  const tr = await getTranslations("crm.reports");

  const [ins, report] = await Promise.all([
    getDashboardInsights(ctx.organizationId),
    getSalesReport(ctx.organizationId, "MONTH"),
  ]);
  const brl = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const maxReason = Math.max(1, ...report.lossReasons.map((l) => l.count));
  const maxStageValue = Math.max(1, ...ins.stages.map((s) => s.value));

  const pieModels: string[] = [
    ...PIE_MODELS,
    ...(hasFeature(ctx.organization.plan as PlanKey, "finance") ? PIE_FINANCE_MODELS : []),
  ];

  const kpis = [
    { icon: TrendingUp, label: t("openCount"), value: String(ins.pipeline.openCount) },
    { icon: CircleDollarSign, label: t("openValue"), value: brl.format(ins.pipeline.openValue) },
    { icon: Target, label: t("forecast"), value: brl.format(ins.pipeline.weightedValue) },
    {
      icon: Trophy,
      label: t("wonMonth"),
      value: brl.format(ins.pipeline.wonValue),
      hint: t("wonLost", { won: ins.pipeline.wonCount, lost: ins.pipeline.lostCount }),
    },
  ];

  const secondary = [
    { icon: Building2, label: t("companies"), value: ins.crm.companies, href: "/app/companies" },
    { icon: Contact, label: t("contacts"), value: ins.crm.contacts, href: "/app/contacts" },
    { icon: Send, label: t("dispatchMonth"), value: ins.campaigns.sentMonth, href: "/app/campaigns" },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Photo hero banner — a dark scrim over the office photo, identical in
          light and dark so the image always shows and the text stays white. */}
      <div className="relative overflow-hidden rounded-2xl border border-border p-6 shadow-sm sm:p-8">
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative, self-hosted */}
        <img
          aria-hidden
          alt=""
          src="/backgrounds/office-2.jpg"
          className="pointer-events-none absolute inset-0 size-full scale-110 object-cover blur-[2px]"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/60 to-slate-950/25" />
        <div className="relative">
          <h1 className="text-2xl font-bold tracking-tight text-white">{t("title")}</h1>
          <p className="mt-1 text-white/75">{t("welcome", { name: ctx.user.name })}</p>
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

      <PieCard models={pieModels} defaultModel="opps_by_stage" />

      <section className="glass rounded-xl border border-border p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("funnelTitle")}</h2>
          <Link
            href="/app/crm"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
          >
            {t("viewPipeline")}
            <ArrowRight className="size-4" />
          </Link>
        </div>
        {ins.stages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("emptyFunnel")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ins.stages.map((s) => (
              <li key={s.id} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm">{s.name}</span>
                <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted">
                  <div
                    className="flex h-full items-center rounded-md bg-brand/80 px-2"
                    style={{ width: `${Math.max(6, (s.value / maxStageValue) * 100)}%` }}
                  >
                    <span className="truncate text-xs font-medium text-brand-foreground">
                      {brl.format(s.value)}
                    </span>
                  </div>
                </div>
                <span className="w-10 shrink-0 text-right text-sm text-muted-foreground">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sales performance this month (moved here from a separate report page). */}
      <section className="glass rounded-xl border border-border p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold">{tr("title")}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: tr("winRate"), value: pct(report.winRate), hint: tr("wonLost", { won: report.won, lost: report.lost }) },
              { label: tr("avgTicket"), value: brl.format(report.avgTicket) },
              { label: tr("avgCycle"), value: report.avgCycleDays === null ? "—" : tr("days", { n: report.avgCycleDays }) },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="mt-1 text-lg font-bold">{k.value}</p>
                {k.hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{k.hint}</p> : null}
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{tr("lossReasonsTitle")}</p>
            {report.lossReasons.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{tr("noReasons")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {report.lossReasons.slice(0, 5).map((l) => (
                  <li key={l.reason} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-xs" title={l.reason}>{l.reason}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded-md bg-muted">
                      <div className="h-full rounded-md bg-red-500/70" style={{ width: `${Math.max(6, (l.count / maxReason) * 100)}%` }} />
                    </div>
                    <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">{l.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="stagger-children grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {secondary.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className={cn(
              "hover-lift glass flex items-center justify-between rounded-xl border border-border p-5 shadow-sm",
              "hover:border-brand/40",
            )}
          >
            <div>
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-xl font-semibold">{s.value}</p>
            </div>
            <s.icon className="size-5 text-muted-foreground" />
          </Link>
        ))}
      </section>
    </div>
  );
}
