import { getTranslations } from "next-intl/server";
import { Users, CreditCard, ScrollText, UserRound, ShieldCheck, ArrowRight, Building2, Gauge } from "lucide-react";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { getUsageSummary, type UsageMetric } from "@/lib/queries/usage";
import { type PlanKey } from "@/config/plans";
import { LeaveTeamButton } from "@/components/app/leave-team-button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const UNLIMITED = 1_000_000;

function UsageRow({ label, metric }: { label: string; metric: UsageMetric }) {
  const unlimited = metric.limit === null || metric.limit >= UNLIMITED;
  const pct =
    metric.limit === null || unlimited
      ? 0
      : Math.min(100, Math.round((metric.used / Math.max(1, metric.limit)) * 100));
  const barColor = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-brand";

  return (
    <div className="glass rounded-xl border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {unlimited ? `${metric.used} / ∞` : `${metric.used} / ${metric.limit}`}
        </span>
      </div>
      {!unlimited ? (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("settings");
  const isAdmin = hasRole(ctx.role, "ADMIN");

  const usage = await getUsageSummary(ctx.organizationId, ctx.organization.plan as PlanKey);

  const stats = [
    { icon: Building2, label: t("org"), value: ctx.organization.name, sub: ctx.organization.slug },
    { icon: CreditCard, label: t("plan"), value: ctx.organization.plan, sub: null },
    { icon: ShieldCheck, label: t("yourRole"), value: ctx.role, sub: null },
  ];

  const shortcuts = [
    { href: "/app/settings/profile", icon: UserRound, label: t("nav.profile"), desc: t("sections.profileDesc"), show: true },
    { href: "/app/settings/team", icon: Users, label: t("nav.team"), desc: t("sections.teamDesc"), show: true },
    { href: "/app/settings/access", icon: ShieldCheck, label: t("nav.access"), desc: t("sections.accessDesc"), show: isAdmin },
    { href: "/app/settings/audit", icon: ScrollText, label: t("nav.audit"), desc: t("sections.auditDesc"), show: isAdmin },
    { href: "/app/settings/plans", icon: CreditCard, label: t("nav.plans"), desc: t("sections.plansDesc"), show: true },
  ].filter((s) => s.show);

  return (
    <div className="flex flex-col gap-8">
      <section className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="glass rounded-xl border border-border p-5 shadow-sm">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <s.icon className="size-4" />
              {s.label}
            </p>
            <p className="mt-1 truncate text-lg font-semibold">{s.value}</p>
            {s.sub ? <p className="truncate text-xs text-muted-foreground">{s.sub}</p> : null}
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Gauge className="size-4 text-brand" />
          {t("usageTitle")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <UsageRow label={t("usage.seats")} metric={usage.seats} />
          <UsageRow label={t("usage.connections")} metric={usage.connections} />
          <UsageRow label={t("usage.dispatch")} metric={usage.dispatch} />
          <UsageRow label={t("usage.searches")} metric={usage.searches} />
          <UsageRow label={t("usage.prospecting")} metric={usage.prospecting} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("usageHint")}</p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("sections.title")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="hover-lift glass group flex items-start gap-3 rounded-xl border border-border p-5 shadow-sm hover:border-brand/40"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <s.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 font-medium">
                  {s.label}
                  <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{s.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {ctx.role !== "OWNER" ? (
        <section>
          <LeaveTeamButton />
        </section>
      ) : null}
    </div>
  );
}
