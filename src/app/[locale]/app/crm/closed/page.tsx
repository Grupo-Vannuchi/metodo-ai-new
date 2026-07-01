import { getTranslations } from "next-intl/server";
import { Eye } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listClosedOpportunities, type ClosedStatusFilter } from "@/lib/queries/crm";
import { ReopenButton } from "@/components/crm/reopen-button";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const FILTERS: ClosedStatusFilter[] = ["ALL", "LOST", "CANCELED", "WON"];
const STATUS_STYLE: Record<string, string> = {
  WON: "bg-green-500/10 text-green-600",
  LOST: "bg-red-500/10 text-red-600",
  CANCELED: "bg-amber-500/10 text-amber-600",
};

export default async function ClosedOpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.closed");
  const to = await getTranslations("crm.opportunity");

  const raw = (await searchParams)?.status;
  const status = (FILTERS.includes(raw as ClosedStatusFilter) ? raw : "ALL") as ClosedStatusFilter;
  const opps = await listClosedOpportunities(ctx.organizationId, { status });

  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/app/crm" className={buttonVariants({ variant: "outline" })}>
          {to("back")}
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/app/crm/closed?status=${f}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              f === status
                ? "border-brand bg-brand/10 font-medium text-brand"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {t(`filter.${f}`)}
          </Link>
        ))}
      </div>

      {opps.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("colOpp")}</th>
                <th className="px-5 py-3 font-medium">{t("colValue")}</th>
                <th className="px-5 py-3 font-medium">{t("colStatus")}</th>
                <th className="px-5 py-3 font-medium">{t("colClosedAt")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {opps.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-5 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {o.code ? <span className="mr-2 text-xs tabular-nums text-muted-foreground">{o.code}</span> : null}
                        {o.title}
                      </span>
                      {o.companyName || o.contactName ? (
                        <span className="text-xs text-muted-foreground">
                          {[o.companyName, o.contactName].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                      {o.outcomeReason ? (
                        <span className="mt-0.5 text-xs text-muted-foreground">
                          {to("outcomeReason")}: {o.outcomeReason}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-5 py-3 font-semibold tabular-nums text-brand">{formatBRL(o.value)}</td>
                  <td className="px-5 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[o.status])}>
                      {to(`status${o.status}`)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{fmtDate(o.closedAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/app/crm/${o.id}`}
                        className="inline-flex items-center rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={to("edit")}
                      >
                        <Eye className="size-4" />
                      </Link>
                      <ReopenButton id={o.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
