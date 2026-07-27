"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { useRouter } from "@/i18n/navigation";

/** Shift a "YYYY-MM" string by whole months. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Month picker for the goals page: prev/next + jump to any month. */
export function GoalsMonthNav({ month, label }: { month: string; label: string }) {
  const t = useTranslations("crm.goals");
  const router = useRouter();
  const go = (m: string) => router.push(`/app/goals?month=${m}`);

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      <button
        type="button"
        onClick={() => go(shiftMonth(month, -1))}
        aria-label={t("prevMonth")}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
      </button>

      <label className="relative flex items-center gap-1.5 px-2 text-sm font-medium">
        <CalendarDays className="size-4 text-muted-foreground" />
        <span className="capitalize">{label}</span>
        {/* The native month input sits invisibly on top so the whole label opens it. */}
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && go(e.target.value)}
          aria-label={t("chooseMonth")}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>

      <button
        type="button"
        onClick={() => go(shiftMonth(month, 1))}
        aria-label={t("nextMonth")}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
