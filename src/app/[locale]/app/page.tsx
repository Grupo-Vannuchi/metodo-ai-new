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

  const ins = await getDashboardInsights(ctx.organizationId);
  const brl = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("welcome", { name: ctx.user.name })}</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-5">
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

      <section className="rounded-xl border border-border bg-card p-5">
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

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {secondary.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className={cn(
              "flex items-center justify-between rounded-xl border border-border bg-card p-5",
              "transition-colors hover:bg-muted/50",
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
