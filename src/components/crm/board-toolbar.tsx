"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LayoutGrid, List, Search, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { BoardStatusFilter, BoardPeriodFilter } from "@/lib/queries/crm";

type PipelineOpt = { id: string; name: string };
type Owner = "all" | "me";
type View = "kanban" | "list";

const STATUSES: BoardStatusFilter[] = ["ACTIVE", "OPEN", "ON_HOLD", "WON", "LOST", "CANCELED"];
const PERIODS: BoardPeriodFilter[] = ["ALL", "TODAY", "7D", "30D", "MONTH", "YEAR"];

export type BoardToolbarState = {
  pipelineId: string;
  owner: Owner;
  status: BoardStatusFilter;
  period: BoardPeriodFilter;
  view: View;
  search: string;
};

const selectClass = cn(
  "h-9 rounded-lg border border-border bg-card px-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

/**
 * The funnel board controls: funnel dropdown, situation + period filters, an
 * owner toggle (all/mine) and a Kanban/List view toggle. Every control keeps the
 * other params intact when it navigates. Also remembers the open funnel (cookie)
 * so returning to the board restores it instead of the first one.
 */
export function BoardToolbar({
  pipelines,
  current,
}: {
  pipelines: PipelineOpt[];
  current: BoardToolbarState;
}) {
  const t = useTranslations("crm.board");
  const router = useRouter();

  // Local search box (debounced). Kept in sync when the URL search changes from
  // elsewhere (e.g. a saved view) via the render-phase derive below.
  const [value, setValue] = useState(current.search);
  const [prevSearch, setPrevSearch] = useState(current.search);
  if (prevSearch !== current.search) {
    setPrevSearch(current.search);
    setValue(current.search);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Remember the funnel that's open so `/app/crm` (no param) reopens it.
  useEffect(() => {
    if (current.pipelineId) {
      document.cookie = `crm_pipeline=${current.pipelineId}; path=/; max-age=31536000; samesite=lax`;
    }
  }, [current.pipelineId]);

  function href(overrides: Partial<BoardToolbarState>): string {
    const next = { ...current, ...overrides };
    const p = new URLSearchParams();
    if (next.pipelineId) p.set("pipeline", next.pipelineId);
    if (next.owner === "me") p.set("owner", "me");
    if (next.status !== "ACTIVE") p.set("status", next.status);
    if (next.period !== "ALL") p.set("period", next.period);
    if (next.view !== "kanban") p.set("view", next.view);
    if (next.search.trim()) p.set("q", next.search.trim());
    const qs = p.toString();
    return qs ? `/app/crm?${qs}` : "/app/crm";
  }

  function onSearch(v: string) {
    setValue(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.push(href({ search: v })), 350);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    clearTimeout(timer.current);
    router.push(href({ search: value }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form onSubmit={submitSearch} className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={value}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className={cn("h-9 w-48 rounded-lg border border-border bg-card pl-8 pr-8 text-sm", "focus-visible:border-brand focus-visible:outline-none")}
        />
        {value ? (
          <button
            type="button"
            onClick={() => onSearch("")}
            aria-label={t("searchClear")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </form>

      {pipelines.length > 1 ? (
        <select
          aria-label={t("pipelineLabel")}
          value={current.pipelineId}
          onChange={(e) => router.push(href({ pipelineId: e.target.value }))}
          className={cn(selectClass, "max-w-56 font-medium")}
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}

      <select
        aria-label={t("statusLabel")}
        value={current.status}
        onChange={(e) => router.push(href({ status: e.target.value as BoardStatusFilter }))}
        className={selectClass}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`filters.status.${s}`)}
          </option>
        ))}
      </select>

      <select
        aria-label={t("periodLabel")}
        value={current.period}
        onChange={(e) => router.push(href({ period: e.target.value as BoardPeriodFilter }))}
        className={selectClass}
      >
        {PERIODS.map((p) => (
          <option key={p} value={p}>
            {t(`filters.period.${p}`)}
          </option>
        ))}
      </select>

      {/* Owner: all / mine */}
      <div className="flex items-center rounded-lg border border-border p-0.5">
        <button
          type="button"
          onClick={() => router.push(href({ owner: "all" }))}
          className={cn(
            "rounded-md px-3 py-1 text-sm transition-colors",
            current.owner === "all" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t("allDeals")}
        </button>
        <button
          type="button"
          onClick={() => router.push(href({ owner: "me" }))}
          className={cn(
            "rounded-md px-3 py-1 text-sm transition-colors",
            current.owner === "me" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t("myDeals")}
        </button>
      </div>

      {/* View: kanban / list */}
      <div className="flex items-center rounded-lg border border-border p-0.5">
        <button
          type="button"
          aria-label={t("viewKanban")}
          title={t("viewKanban")}
          onClick={() => router.push(href({ view: "kanban" }))}
          className={cn(
            "rounded-md px-2 py-1 transition-colors",
            current.view === "kanban" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <LayoutGrid className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t("viewList")}
          title={t("viewList")}
          onClick={() => router.push(href({ view: "list" }))}
          className={cn(
            "rounded-md px-2 py-1 transition-colors",
            current.view === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <List className="size-4" />
        </button>
      </div>
    </div>
  );
}
