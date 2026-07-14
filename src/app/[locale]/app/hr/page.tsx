import { getTranslations } from "next-intl/server";
import { Users, UserMinus, Wallet, UserPlus, Cake, Clock, FileWarning } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { hrDashboard } from "@/lib/queries/hr";
import { Link } from "@/i18n/navigation";
import { formatBRL } from "@/lib/money";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) => new Date(d).toLocaleDateString("pt-BR");

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${accent ? "text-brand" : ""}`}>{value}</p>
    </div>
  );
}

export default async function HrOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("hr");

  const d = await hrDashboard(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Users} label={t("stat.headcount")} value={String(d.headcount)} />
        <Stat icon={Wallet} label={t("stat.monthlyCost")} value={formatBRL(d.monthlyCost)} accent />
        <Stat icon={UserPlus} label={t("stat.hiredThisMonth")} value={String(d.hiredThisMonth)} />
        <Stat icon={UserMinus} label={t("stat.onLeave")} value={String(d.onLeave)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Birthdays */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Cake className="size-4 text-brand" />
            {t("alert.birthdays")}
          </h2>
          {d.birthdays.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("alert.noBirthdays")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {d.birthdays.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/app/hr/employees/${b.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <span className="truncate">{b.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{t("alert.day", { day: b.day })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Probation ending */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4 text-amber-600" />
            {t("alert.probation")}
          </h2>
          {d.probationEnding.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("alert.noProbation")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {d.probationEnding.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/app/hr/employees/${p.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(p.date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Expiring documents */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FileWarning className="size-4 text-red-600" />
            {t("alert.expiringDocs")}
          </h2>
          {d.expiringDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("alert.noExpiringDocs")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {d.expiringDocs.map((doc) => (
                <li key={doc.id}>
                  <Link
                    href={`/app/hr/employees/${doc.employeeId}`}
                    className="block rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <span className="block truncate font-medium">{doc.name}</span>
                    <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{doc.employeeName}</span>
                      <span className="shrink-0">{fmtDate(doc.expiresAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
