"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");
const toStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/**
 * Clickable calendar range picker for the funnel period filter. Click a start
 * day then an end day; quick presets and a clear are below. Emits YYYY-MM-DD
 * strings (or null to clear) — the toolbar turns those into ?from=&to=.
 */
export function DateRangePicker({
  from,
  to,
  onApply,
}: {
  from: string;
  to: string;
  onApply: (from: string | null, to: string | null) => void;
}) {
  const t = useTranslations("crm.board");
  const locale = useLocale();
  const intlLocale = locale === "pt" ? "pt-BR" : "en-US";

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(() => (from ? parse(from) : new Date()));
  const [start, setStart] = useState<string | null>(from || null);
  const [end, setEnd] = useState<string | null>(to || null);

  // Keep local selection in sync when the URL range changes elsewhere (saved
  // view, clear) — render-phase derive.
  const [prev, setPrev] = useState(`${from}|${to}`);
  if (prev !== `${from}|${to}`) {
    setPrev(`${from}|${to}`);
    setStart(from || null);
    setEnd(to || null);
    setView(from ? parse(from) : new Date());
  }

  const fmt = (s: string) => parse(s).toLocaleDateString(intlLocale, { day: "2-digit", month: "2-digit" });
  const label = from && to ? `${fmt(from)} – ${fmt(to)}` : from ? `${fmt(from)} –` : t("periodLabel");

  const y = view.getFullYear();
  const m = view.getMonth();
  const monthTitle = new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }).format(view);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    // Jan 1 2023 is a Sunday — gives Sun..Sat narrow names in the locale.
    new Intl.DateTimeFormat(intlLocale, { weekday: "narrow" }).format(new Date(2023, 0, 1 + i)),
  );

  const startWeekday = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));

  function clickDay(d: Date) {
    const s = toStr(d);
    if (!start || (start && end)) {
      setStart(s);
      setEnd(null);
      return;
    }
    if (s < start) {
      setStart(s);
      setEnd(null);
      return;
    }
    setEnd(s);
    onApply(start, s);
    setOpen(false);
  }

  function preset(kind: "TODAY" | "7D" | "30D" | "MONTH" | "ALL") {
    if (kind === "ALL") {
      onApply(null, null);
      setOpen(false);
      return;
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let f = today;
    if (kind === "7D") {
      f = new Date(today);
      f.setDate(f.getDate() - 6);
    } else if (kind === "30D") {
      f = new Date(today);
      f.setDate(f.getDate() - 29);
    } else if (kind === "MONTH") {
      f = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    onApply(toStr(f), toStr(today));
    setOpen(false);
  }

  const inRange = (d: Date) => {
    const s = toStr(d);
    if (start && end) return s >= start && s <= end;
    return s === start;
  };
  const isEndpoint = (d: Date) => {
    const s = toStr(d);
    return s === start || s === end;
  };

  return (
    <div className="relative">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm",
            from ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <CalendarIcon className="size-4" />
          <span>{label}</span>
        </button>
        {from ? (
          <button
            type="button"
            onClick={() => onApply(null, null)}
            aria-label={t("filters.period.ALL")}
            className="ml-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {open ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div className="glass-strong absolute left-0 z-50 mt-2 w-72 rounded-xl border border-border p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => setView(new Date(y, m - 1, 1))} aria-label="←" className="rounded p-1 hover:bg-muted">
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-sm font-medium capitalize">{monthTitle}</span>
              <button type="button" onClick={() => setView(new Date(y, m + 1, 1))} aria-label="→" className="rounded p-1 hover:bg-muted">
                <ChevronRight className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] uppercase text-muted-foreground">
              {weekdays.map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-y-1">
              {cells.map((d, i) =>
                d === null ? (
                  <span key={i} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => clickDay(d)}
                    className={cn(
                      "mx-auto flex size-8 items-center justify-center rounded-md text-sm transition-colors",
                      isEndpoint(d)
                        ? "bg-brand font-medium text-brand-foreground"
                        : inRange(d)
                          ? "bg-brand/15 text-foreground"
                          : "hover:bg-muted",
                    )}
                  >
                    {d.getDate()}
                  </button>
                ),
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-2">
              {(["TODAY", "7D", "30D", "MONTH"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => preset(k)}
                  className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t(`filters.period.${k}`)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => preset("ALL")}
                className="ml-auto rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("filters.period.ALL")}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
