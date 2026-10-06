import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import {
  getEmailBroadcast,
  getEmailBroadcastReport,
  type ReportFilter,
} from "@/lib/queries/email-broadcasts";
import { readStats } from "@/lib/validations/email-broadcast";
import { composeEmail } from "@/lib/email-broadcast/compose";
import { getResendConnection, deliveryTrackingActive } from "@/lib/email-broadcast/connection";
import { StatusBadge } from "@/components/email/status-badge";
import { ReportActions } from "@/components/email/report-actions";
import { AutoRefresh } from "@/components/email/auto-refresh";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FILTERS: ReportFilter[] = ["all", "queued", "sent", "delivered", "problems"];
const COUNTER_ORDER = ["QUEUED", "SENT", "DELIVERED", "BOUNCED", "COMPLAINED", "FAILED"] as const;
const BAR_COLORS: Record<(typeof COUNTER_ORDER)[number], string> = {
  QUEUED: "bg-transparent",
  SENT: "bg-blue-500",
  DELIVERED: "bg-green-600",
  BOUNCED: "bg-red-600",
  COMPLAINED: "bg-amber-600",
  FAILED: "bg-red-400",
};

export default async function EmailReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const format = await getFormatter();

  const b = await getEmailBroadcast(ctx.organizationId, id);
  if (!b) notFound();
  if (b.status === "DRAFT") redirect({ href: `/app/email/${id}/edit`, locale });

  const requested = (await searchParams).status ?? "all";
  const filter: ReportFilter = (FILTERS as string[]).includes(requested) ? (requested as ReportFilter) : "all";
  const [{ counts, recipients, canResume }, conn] = await Promise.all([
    getEmailBroadcastReport(ctx.organizationId, id, filter),
    getResendConnection(ctx.organizationId),
  ]);

  const total = COUNTER_ORDER.reduce((n, s) => n + counts[s], 0);
  const processed = total - counts.QUEUED;
  const stats = readStats(b.stats);
  const filterCount: Record<ReportFilter, number> = {
    all: total,
    queued: counts.QUEUED,
    sent: counts.SENT,
    delivered: counts.DELIVERED,
    problems: counts.BOUNCED + counts.COMPLAINED + counts.FAILED,
  };
  // Preview of what went out, with the tokens left visible.
  const preview = composeEmail({
    subject: b.subject,
    bodyHtml: b.html,
    vars: { nome: "{{nome}}", empresa: "{{empresa}}" },
    orgName: ctx.organization.name,
    unsubscribeUrl: "#",
  });

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={b.status === "SENDING"} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            <Link href="/app/email" className="hover:underline">
              {t("title")}
            </Link>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{b.subject || t("noSubject")}</h1>
            <StatusBadge status={b.status} label={t(`status.${b.status}`)} />
          </div>
          {b.startedAt ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("report.started", { date: format.dateTime(b.startedAt, { dateStyle: "short", timeStyle: "short" }) })}
            </p>
          ) : null}
        </div>
        <ReportActions id={b.id} canResume={canResume} />
      </div>

      {b.status === "PAUSED" && b.pausedReason ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {t(`paused.${b.pausedReason}`)}
          {b.lastError ? ` (${b.lastError})` : ""}
        </p>
      ) : null}
      {conn && !deliveryTrackingActive(conn) ? (
        <p className="text-sm text-muted-foreground">{t("report.noTracking")}</p>
      ) : null}

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
        <p className="font-semibold tabular-nums">{t("report.processed", { done: processed, total })}</p>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
          {COUNTER_ORDER.filter((s) => s !== "QUEUED").map((s) => (
            <div
              key={s}
              className={BAR_COLORS[s]}
              style={{ width: total ? `${(counts[s] / total) * 100}%` : "0%" }}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {COUNTER_ORDER.map((s) => (
            <div key={s} className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2">
              <span className="text-xs text-muted-foreground">{t(`report.counters.${s}`)}</span>
              <span className="text-xl font-bold tabular-nums">{format.number(counts[s])}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {t("report.removed", { duplicates: stats.duplicates, suppressed: stats.suppressed, invalid: stats.invalid })}
        </p>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <nav className="flex flex-wrap gap-2 border-b border-border p-3">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={f === "all" ? `/app/email/${id}` : `/app/email/${id}?status=${f}`}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium tabular-nums",
                f === filter ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`report.filter.${f}`)} · {format.number(filterCount[f])}
            </Link>
          ))}
        </nav>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("report.col.recipient")}</th>
                <th className="px-5 py-3 font-medium">{t("report.col.source")}</th>
                <th className="px-5 py-3 font-medium">{t("report.col.status")}</th>
                <th className="px-5 py-3 font-medium">{t("report.col.updated")}</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium">{r.name ?? r.email}</div>
                    {r.name ? <div className="text-xs text-muted-foreground">{r.email}</div> : null}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {r.sources.map((s) => t(`report.source.${s}`)).join(" + ")}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={r.status} label={t(`report.counters.${r.status}`)} />
                    {r.error ? <div className="mt-1 max-w-sm text-xs text-red-600">{r.error}</div> : null}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {format.dateTime(r.updatedAt, { dateStyle: "short", timeStyle: "short" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {recipients.length === 200 ? (
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            {t("report.showing", { count: 200 })}
          </p>
        ) : null}
      </section>

      <details className="rounded-xl border border-border bg-card p-5">
        <summary className="cursor-pointer text-sm font-medium text-brand">{t("report.viewEmail")}</summary>
        <iframe
          title={t("report.viewEmail")}
          srcDoc={preview.html}
          sandbox=""
          className="mt-4 h-[600px] w-full rounded-lg border border-border bg-white"
        />
      </details>
    </div>
  );
}
