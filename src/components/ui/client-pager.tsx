"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Client-side pagination for already-loaded lists (no server round-trip).
 * `resetKey` jumps back to page 1 when it changes (e.g. a tab/day filter) —
 * done by adjusting state during render (React's "store prev prop" pattern),
 * not an effect.
 */
export function usePaged<T>(items: T[], pageSize: number, resetKey?: unknown) {
  const [page, setPage] = useState(1);
  const [prevKey, setPrevKey] = useState(resetKey);
  if (resetKey !== prevKey) {
    setPrevKey(resetKey);
    setPage(1);
  }
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, totalPages);
  const pageItems = items.slice((current - 1) * pageSize, current * pageSize);
  return { pageItems, page: current, setPage, totalPages, total: items.length };
}

/** Compact prev/next pager. Renders nothing for a single page. */
export function Pager({
  page,
  totalPages,
  onPage,
  className,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  const btn =
    "rounded-md p-1.5 text-muted-foreground transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-40";
  return (
    <div className={cn("flex items-center justify-center gap-3 pt-1 text-sm text-muted-foreground", className)}>
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="‹">
        <ChevronLeft className="size-4" />
      </button>
      <span className="tabular-nums">
        {page} / {totalPages}
      </span>
      <button type="button" className={btn} disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="›">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
