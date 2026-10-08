import { getFormatter, getTranslations } from "next-intl/server";
import { AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listEmailBroadcasts, countEmailsSentThisMonth } from "@/lib/queries/email-broadcasts";
import { deliveryTrackingConfigured } from "@/lib/email-broadcast/platform";
import { listSenderDomains } from "@/lib/queries/email-sender-domains";
import { DeleteButton } from "@/components/crm/delete-button";
import { deleteEmailDraft } from "@/app/actions/email-broadcasts";
import { StatusBadge } from "@/components/email/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { LIMITS } from "@/config/limits";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const format = await getFormatter();

  const [rows, domains, used] = await Promise.all([
    listEmailBroadcasts(ctx.organizationId),
    listSenderDomains(ctx.organizationId),
    countEmailsSentThisMonth(ctx.organizationId),
  ]);
  const tracking = deliveryTrackingConfigured();
  const limit = LIMITS.emailBroadcastQuotaPerMonth;
  const pct = Math.min(100, (used / limit) * 100);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/app/email/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("new")}
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {domains.length > 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4">
            <CheckCircle2 className="size-5 shrink-0 text-green-600" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t("domains.title")}</p>
              <p className="truncate text-sm text-muted-foreground">
                {domains.join(", ")} · {tracking ? t("domains.tracking") : t("domains.noTracking")}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t("domains.noneTitle")}</p>
              <p className="text-sm">{t("domains.noneBody")}</p>
            </div>
          </div>
        )}
        <div className="flex flex-col justify-center gap-2 rounded-xl border border-border bg-card px-5 py-4">
          <div className="flex justify-between text-sm tabular-nums">
            <span className="text-muted-foreground">{t("quota.label")}</span>
            <span className="font-medium">
              {t("quota.value", { used: format.number(used), limit: format.number(limit) })}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("col.subject")}</th>
                <th className="px-5 py-3 font-medium">{t("col.status")}</th>
                <th className="px-5 py-3 text-right font-medium">{t("col.recipients")}</th>
                <th className="px-5 py-3 text-right font-medium">{t("col.delivered")}</th>
                <th className="px-5 py-3 text-right font-medium">{t("col.problems")}</th>
                <th className="px-5 py-3 font-medium">{t("col.date")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isDraft = r.status === "DRAFT";
                const href = isDraft ? `/app/email/${r.id}/edit` : `/app/email/${r.id}`;
                const when = format.dateTime(r.startedAt ?? r.updatedAt, { dateStyle: "short", timeStyle: "short" });
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 font-medium">
                      <Link href={href} className="hover:underline">
                        {r.subject || t("noSubject")}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={r.status} label={t(`status.${r.status}`)} />
                    </td>
                    <td className="px-5 py-3 text-right">{isDraft ? "—" : format.number(r.total)}</td>
                    <td className="px-5 py-3 text-right">{isDraft ? "—" : format.number(r.delivered)}</td>
                    <td className="px-5 py-3 text-right">{isDraft ? "—" : format.number(r.problems)}</td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {isDraft ? t("editedAt", { date: when }) : when}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {isDraft ? <DeleteButton action={deleteEmailDraft.bind(null, r.id)} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
