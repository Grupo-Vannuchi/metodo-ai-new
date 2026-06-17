import { getTranslations } from "next-intl/server";
import { Users, CreditCard, ScrollText } from "lucide-react";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { getUsageSummary, type UsageMetric } from "@/lib/queries/usage";
import { type PlanKey } from "@/config/plans";
import { buttonVariants } from "@/components/ui/button";
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
  const barColor =
    pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-brand";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
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

  const usage = await getUsageSummary(ctx.organizationId, ctx.organization.plan as PlanKey);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">{t("org")}</p>
          <p className="mt-1 text-lg font-semibold">{ctx.organization.name}</p>
          <p className="text-xs text-muted-foreground">{ctx.organization.slug}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">{t("plan")}</p>
          <p className="mt-1 text-lg font-semibold">{ctx.organization.plan}</p>
          <Link href="/pricing" className="text-xs font-medium text-brand underline underline-offset-4">
            {t("seePlans")}
          </Link>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">{t("yourRole")}</p>
          <p className="mt-1 text-lg font-semibold">{ctx.role}</p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("usageTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <UsageRow label={t("usage.seats")} metric={usage.seats} />
          <UsageRow label={t("usage.connections")} metric={usage.connections} />
          <UsageRow label={t("usage.dispatch")} metric={usage.dispatch} />
          <UsageRow label={t("usage.searches")} metric={usage.searches} />
          <UsageRow label={t("usage.prospecting")} metric={usage.prospecting} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("usageHint")}</p>
      </section>

      <section className="flex flex-wrap gap-3">
        <Link href="/app/settings/team" className={buttonVariants({ variant: "outline" })}>
          <Users className="size-4" />
          {t("manageTeam")}
        </Link>
        <Link href="/pricing" className={buttonVariants({ variant: "outline" })}>
          <CreditCard className="size-4" />
          {t("seePlans")}
        </Link>
        {hasRole(ctx.role, "ADMIN") ? (
          <Link href="/app/settings/audit" className={buttonVariants({ variant: "outline" })}>
            <ScrollText className="size-4" />
            {t("auditLog")}
          </Link>
        ) : null}
      </section>
    </div>
  );
}
