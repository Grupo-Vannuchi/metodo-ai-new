"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { TIME_OFF_STATUS_FILTERS, type TimeOffStatusFilter } from "@/lib/validations/time-off";

const selectClass = cn(
  "h-9 rounded-lg border border-border bg-card px-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

/** Status filter for the time-off list. */
export function TimeOffToolbar({ status }: { status: TimeOffStatusFilter }) {
  const t = useTranslations("hr");
  const router = useRouter();

  return (
    <select
      aria-label={t("timeOff.colStatus")}
      value={status}
      onChange={(e) => {
        const s = e.target.value as TimeOffStatusFilter;
        router.push(s === "ALL" ? "/app/hr/timeoff" : `/app/hr/timeoff?status=${s}`);
      }}
      className={selectClass}
    >
      {TIME_OFF_STATUS_FILTERS.map((s) => (
        <option key={s} value={s}>
          {s === "ALL" ? t("filterAll") : t(`timeOff.status.${s}`)}
        </option>
      ))}
    </select>
  );
}
