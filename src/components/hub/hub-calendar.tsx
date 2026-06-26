"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { TaskRow } from "@/lib/queries/tasks";
import type { HubOpportunity } from "@/lib/queries/hub";

/** Local yyyy-mm-dd key for a date (in the viewer's timezone). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PRIORITY_DOT: Record<string, string> = {
  HIGH: "bg-red-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-zinc-400",
};

/**
 * Month calendar (pure React, no dependency). Buckets the user's tasks (by
 * dueDate) and opportunities (by expectedCloseDate) onto days and renders them
 * as coloured dots. Clicking a day reports it up so the tabs can filter to it;
 * clicking the selected day again clears the filter.
 */
export function HubCalendar({
  tasks,
  opps,
  todayISO,
  selectedKey,
  onSelectDay,
}: {
  tasks: TaskRow[];
  opps: HubOpportunity[];
  todayISO: string;
  selectedKey: string | null;
  onSelectDay: (key: string | null) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("my");
  const today = new Date(todayISO); // a fixed instant → interpreted in local time
  const todayKey = dayKey(today);
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });

  const buckets = useMemo(() => {
    const map = new Map<string, { tasks: TaskRow[]; opps: HubOpportunity[] }>();
    const at = (k: string) => map.get(k) ?? map.set(k, { tasks: [], opps: [] }).get(k)!;
    for (const task of tasks) if (task.dueDate) at(dayKey(new Date(task.dueDate))).tasks.push(task);
    for (const o of opps) if (o.expectedCloseDate) at(dayKey(new Date(o.expectedCloseDate))).opps.push(o);
    return map;
  }, [tasks, opps]);

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    // 2024-01-07 is a Sunday.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 7 + i)));
  }, [locale]);

  const first = new Date(view.y, view.m, 1);
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.y, view.m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(first);
  const shift = (delta: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold capitalize">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="‹"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setView({ y: today.getFullYear(), m: today.getMonth() });
              onSelectDay(null);
            }}
            className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t("today")}
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="›"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-medium uppercase text-muted-foreground">
        {weekdays.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const k = dayKey(d);
          const b = buckets.get(k);
          const isToday = k === todayKey;
          const isSel = k === selectedKey;
          const total = (b?.tasks.length ?? 0) + (b?.opps.length ?? 0);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelectDay(isSel ? null : k)}
              className={cn(
                "flex min-h-[3.25rem] flex-col items-center gap-1 rounded-lg p-1 text-xs transition-colors hover:bg-muted",
                isSel ? "bg-brand/10 ring-1 ring-brand" : "",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full",
                  isToday ? "bg-brand font-semibold text-brand-foreground" : "",
                )}
              >
                {d.getDate()}
              </span>
              {total > 0 ? (
                <span className="flex max-w-full flex-wrap items-center justify-center gap-0.5">
                  {b!.tasks.slice(0, 3).map((task, j) => (
                    <span
                      key={`t${j}`}
                      className={cn(
                        "size-1.5 rounded-full",
                        task.doneAt ? "bg-zinc-300" : (PRIORITY_DOT[task.priority] ?? "bg-zinc-400"),
                      )}
                    />
                  ))}
                  {b!.opps.slice(0, 2).map((_, j) => (
                    <span key={`o${j}`} className="size-1.5 rounded-full bg-brand" />
                  ))}
                  {total > 5 ? <span className="text-[9px] leading-none text-muted-foreground">+</span> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <Legend className="bg-red-500" label={t("legendHigh")} />
        <Legend className="bg-amber-500" label={t("legendMedium")} />
        <Legend className="bg-zinc-400" label={t("legendLow")} />
        <Legend className="bg-brand" label={t("legendOpp")} />
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("size-1.5 rounded-full", className)} />
      {label}
    </span>
  );
}
