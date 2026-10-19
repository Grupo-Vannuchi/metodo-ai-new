import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import {
  getEmailBroadcast,
  getEmailBroadcastReport,
  type ReportFilter,
} from "@/lib/queries/email-broadcasts";
import { pausedReasonKey, recipientFailure } from "@/lib/email-broadcast/failure-reason";
import { readStats } from "@/lib/validations/email-broadcast";
import { attachmentSizeParts, readAttachments } from "@/lib/email-broadcast/attachments";
import { composeEmail } from "@/lib/email-broadcast/compose";
import { deliveryTrackingConfigured } from "@/lib/email-broadcast/platform";
import { StatusBadge } from "@/components/email/status-badge";
import { ReportActions } from "@/components/email/report-actions";
import { AutoRefresh } from "@/components/email/auto-refresh";
import { emailListHref, listChannelOf } from "@/lib/email-broadcast/list-channel";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PLATFORM_FILTERS: ReportFilter[] = ["all", "queued", "sent", "delivered", "problems"];
const MICROSOFT_FILTERS: ReportFilter[] = ["all", "queued", "sent", "problems", "uncertain"];
const PLATFORM_COUNTERS = ["QUEUED", "SENT", "DELIVERED", "BOUNCED", "COMPLAINED", "FAILED"] as const;
const MICROSOFT_COUNTERS = ["QUEUED", "SENT", "FAILED", "UNCERTAIN"] as const;
type Counter = (typeof PLATFORM_COUNTERS)[number] | (typeof MICROSOFT_COUNTERS)[number];
const BAR_COLORS: Record<Counter, string> = {
  QUEUED: "bg-transparent",
  SENT: "bg-blue-500",
  DELIVERED: "bg-green-600",
  BOUNCED: "bg-red-600",
  COMPLAINED: "bg-amber-600",
  FAILED: "bg-red-400",
  UNCERTAIN: "bg-amber-500",
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
  const microsoft = b.channel === "MICROSOFT";
  const FILTERS = microsoft ? MICROSOFT_FILTERS : PLATFORM_FILTERS;
  const COUNTERS: readonly Counter[] = microsoft ? MICROSOFT_COUNTERS : PLATFORM_COUNTERS;

  const requested = (await searchParams).status ?? "all";
  const filter: ReportFilter = (FILTERS as string[]).includes(requested) ? (requested as ReportFilter) : "all";
  const { counts, recipients, canResume } = await getEmailBroadcastReport(ctx.organizationId, id, filter);

  // SENDING is a recipient in flight: shown inside "Na fila".
  const shown = (s: Counter) => (s === "QUEUED" ? counts.QUEUED + counts.SENDING : counts[s]);
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  const processed = total - counts.QUEUED - counts.SENDING;
  const stats = readStats(b.stats);
  const attachments = readAttachments(b.attachments);
  const sizeLabel = (bytes: number) => {
    const { value, unit } = attachmentSizeParts(bytes);
    return `${format.number(value, { maximumFractionDigits: 1 })} ${unit}`;
  };
  const filterCount: Record<ReportFilter, number> = {
    all: total,
    queued: counts.QUEUED + counts.SENDING,
    sent: counts.SENT,
    delivered: counts.DELIVERED,
    problems: counts.BOUNCED + counts.COMPLAINED + counts.FAILED,
    uncertain: counts.UNCERTAIN,
  };
  // Preview of what went out, with the tokens left visible.
  const preview = composeEmail({
    subject: b.subject,
    bodyHtml: b.html,
    vars: { nome: "{{nome}}", empresa: "{{empresa}}" },
    orgName: ctx.organization.name,
    unsubscribeUrl: "#",
    signature: b.signatureHtml ? { html: b.signatureHtml, text: b.signatureText ?? "" } : null,
  });

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={b.status === "SENDING"} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            <Link href={emailListHref(listChannelOf(b.channel))} className="hover:underline">
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
          {microsoft && b.fromEmail ? (
            <p className="mt-1 text-sm text-muted-foreground">{t("report.viaMicrosoft", { email: b.fromEmail })}</p>
          ) : null}
        </div>
        <ReportActions id={b.id} canResume={canResume} />
      </div>

      {b.status === "PAUSED" && b.pausedReason ? (
        <p className="rounded-xl border border-red-300 bg-red-50 px-5 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {microsoft && pausedReasonKey(b.pausedReason) === "provider_error"
            ? t("paused.provider_error_microsoft")
            : t(`paused.${pausedReasonKey(b.pausedReason)}`)}
          {b.lastError ? <span title={b.lastError}> ({b.lastError.slice(0, 160)})</span> : null}
        </p>
      ) : null}
      {microsoft ? (
        <p className="text-sm text-muted-foreground">{t("report.noTrackingMicrosoft")}</p>
      ) : !deliveryTrackingConfigured() ? (
        <p className="text-sm text-muted-foreground">{t("report.noTracking")}</p>
      ) : null}

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
        <p className="font-semibold tabular-nums">{t("report.processed", { done: processed, total })}</p>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
          {COUNTERS.filter((s) => s !== "QUEUED").map((s) => (
            <div
              key={s}
              className={BAR_COLORS[s]}
              style={{ width: total ? `${(counts[s] / total) * 100}%` : "0%" }}
            />
          ))}
        </div>
        <div
          className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", microsoft ? "lg:grid-cols-4" : "lg:grid-cols-6")}
        >
          {COUNTERS.map((s) => (
            <div key={s} className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2">
              <span className="text-xs text-muted-foreground">{t(`report.counters.${s}`)}</span>
              <span className="text-xl font-bold tabular-nums">{format.number(shown(s))}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {t("report.removed", { duplicates: stats.duplicates, suppressed: stats.suppressed, invalid: stats.invalid })}
        </p>
      </section>

      {attachments.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-3 text-sm font-semibold">{t("report.attachments")}</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {attachments.map((a) => (
              <li key={a.key} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{a.filename}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{sizeLabel(a.size)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
                    {(() => {
                      const failure = recipientFailure(r.error);
                      return failure ? (
                        <div title={failure.technical} className="mt-1 max-w-sm text-xs text-red-600">
                          {t(`failure.${failure.key}`)}
                        </div>
                      ) : null;
                    })()}
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
