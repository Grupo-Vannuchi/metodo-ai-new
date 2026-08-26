import { getTranslations } from "next-intl/server";
import { Users, ScrollText, UserRound, ShieldCheck, ArrowRight, Building2, Gauge, CreditCard, Boxes } from "lucide-react";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { getUsageSummary, type UsageMetric } from "@/lib/queries/usage";
import { accountOwnedModuleIds } from "@/lib/queries/accounts";
import { hasFeatureByModules, hasModule, monthlyTotal } from "@/config/modules";
import { formatBRL } from "@/lib/money";
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

  const usage = await getUsageSummary(ctx.organizationId);
  // Subscription is account-level: purchased modules, billed once.
  const ownedModules = ctx.accountOwnerId ? await accountOwnedModuleIds(ctx.accountOwnerId) : [];
  const total = monthlyTotal(ownedModules);
  const moduleCount = ownedModules.length;

  // Usage rows relevant to what's installed — keeps the panel from listing
  // metrics for modules the org doesn't have (mirrors the modular gating).
  const hasInbox = hasModule(ctx.modules, "inbox");
  const hasMarketing = hasModule(ctx.modules, "marketing");
  const usageRows = [
    { label: t("usage.seats"), metric: usage.seats, show: true },
    { label: t("usage.connections"), metric: usage.connections, show: hasInbox },
    { label: t("usage.dispatch"), metric: usage.dispatch, show: hasMarketing },
    { label: t("usage.searches"), metric: usage.searches, show: hasMarketing },
    { label: t("usage.prospecting"), metric: usage.prospecting, show: hasMarketing },
    { label: t("usage.assistant"), metric: usage.assistant, show: hasFeatureByModules(ctx.modules, "assistant") },
  ].filter((r) => r.show);

  const shortcuts = [
    { href: "/app/settings/profile", icon: UserRound, label: t("nav.profile"), desc: t("sections.profileDesc"), show: true },
    { href: "/app/settings/billing", icon: CreditCard, label: t("nav.billing"), desc: t("sections.billingDesc"), show: true },
    { href: "/app/settings/team", icon: Users, label: t("nav.team"), desc: t("sections.teamDesc"), show: true },
    { href: "/app/settings/access", icon: ShieldCheck, label: t("nav.access"), desc: t("sections.accessDesc"), show: isAdmin },
    { href: "/app/settings/audit", icon: ScrollText, label: t("nav.audit"), desc: t("sections.auditDesc"), show: isAdmin },
  ].filter((s) => s.show);

  return (
    <div className="flex flex-col gap-8">
      {/* Summary: org, role + subscription snapshot */}
      <section className="stagger-children grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="glass rounded-xl border border-border p-5 shadow-sm">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="size-4" />
            {t("org")}
          </p>
          <p className="mt-1 truncate text-lg font-semibold">{ctx.organization.name}</p>
          <p className="truncate text-xs text-muted-foreground">{ctx.organization.slug}</p>
        </div>

        <div className="glass rounded-xl border border-border p-5 shadow-sm">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" />
            {t("yourRole")}
          </p>
          <p className="mt-1 truncate text-lg font-semibold">{ctx.role}</p>
        </div>

        {/* Subscription snapshot — links straight to the billing tab. */}
        <Link
          href="/app/settings/billing"
          className="hover-lift group relative overflow-hidden rounded-xl border border-brand/30 bg-brand/5 p-5 shadow-sm"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{ background: "radial-gradient(120% 120% at 100% 0%, color-mix(in srgb, var(--brand) 18%, transparent), transparent 55%)" }}
          />
          <p className="relative flex items-center gap-2 text-sm text-muted-foreground">
            <CreditCard className="size-4" />
            {t("nav.billing")}
          </p>
          <p className="relative mt-1 text-2xl font-bold text-brand">
            {formatBRL(total)}
            <span className="text-sm font-normal text-muted-foreground">{t("billing.perMonth")}</span>
          </p>
          <p className="relative flex items-center gap-1 text-xs text-muted-foreground">
            <Boxes className="size-3.5" />
            {t("billing.moduleCount", { count: moduleCount })}
            <ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
          </p>
        </Link>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Gauge className="size-4 text-brand" />
          {t("usageTitle")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {usageRows.map((r) => (
            <UsageRow key={r.label} label={r.label} metric={r.metric} />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("usageHint")}</p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("sections.title")}</h2>
        <div className="stagger-children grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
