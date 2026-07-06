"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { ProposalStatusFilter, ProposalPeriodFilter } from "@/lib/queries/proposals";

const STATUSES: ProposalStatusFilter[] = ["ALL", "DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"];
const PERIODS: ProposalPeriodFilter[] = ["ALL", "TODAY", "7D", "30D", "MONTH", "YEAR"];

const selectClass = cn(
  "h-9 rounded-lg border border-border bg-card px-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

/** Status + period filters for the proposals list; each navigates preserving the
 * other. Mirrors the funnel board toolbar. */
export function ProposalsToolbar({
  status,
  period,
}: {
  status: ProposalStatusFilter;
  period: ProposalPeriodFilter;
}) {
  const t = useTranslations("proposals");
  const router = useRouter();

  function href(next: { status?: ProposalStatusFilter; period?: ProposalPeriodFilter }): string {
    const s = next.status ?? status;
    const p = next.period ?? period;
    const params = new URLSearchParams();
    if (s !== "ALL") params.set("status", s);
    if (p !== "ALL") params.set("period", p);
    const qs = params.toString();
    return qs ? `/app/proposals?${qs}` : "/app/proposals";
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={t("filterStatus")}
        value={status}
        onChange={(e) => router.push(href({ status: e.target.value as ProposalStatusFilter }))}
        className={selectClass}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s === "ALL" ? t("filterAll") : t(`status.${s}`)}
          </option>
        ))}
      </select>

      <select
        aria-label={t("filterPeriod")}
        value={period}
        onChange={(e) => router.push(href({ period: e.target.value as ProposalPeriodFilter }))}
        className={selectClass}
      >
        {PERIODS.map((p) => (
          <option key={p} value={p}>
            {t(`period.${p}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
