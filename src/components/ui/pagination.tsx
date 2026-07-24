"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useSessionState } from "@/lib/use-session-state";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * List pager. The page you're on is remembered for the session per list, so
 * returning to that list (without an explicit `?page`) resumes where you were
 * instead of snapping back to the first page.
 */
export function Pagination({ total, pageSize }: { total: number; pageSize: number }) {
  const t = useTranslations("pagination");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const raw = Number(searchParams.get("page")) || 1;
  const currentPage = Math.min(Math.max(1, raw), totalPages);

  // Hooks must run before the early return below, or their order would change
  // between renders.
  const hasPageParam = searchParams.get("page") !== null;
  const [storedPage, setStoredPage, hydrated] = useSessionState<number>(`page:${pathname}`, 1);
  const restored = useRef(false);

  // Remember the page whenever it's explicit in the URL.
  useEffect(() => {
    if (hasPageParam) setStoredPage(currentPage);
  }, [hasPageParam, currentPage, setStoredPage]);

  // Landing on the list with no page in the URL → jump back to the remembered
  // one. Runs once, and `replace` keeps it out of the back-button history.
  useEffect(() => {
    if (!hydrated || restored.current) return;
    restored.current = true;
    if (hasPageParam || storedPage <= 1 || storedPage > totalPages) return;
    const params = new URLSearchParams(searchParams);
    params.set("page", String(storedPage));
    router.replace(`${pathname}?${params.toString()}`);
  }, [hydrated, hasPageParam, storedPage, totalPages, pathname, router, searchParams]);

  if (totalPages <= 1) return null;

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(page));
    router.push(`${pathname}?${params.toString()}`);
  }

  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, total);

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3 sm:px-6">
      <div className="flex flex-1 justify-between sm:hidden">
        <Button type="button" variant="outline" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
          {t("prev")}
        </Button>
        <Button type="button" variant="outline" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>
          {t("next")}
        </Button>
      </div>
      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t("showing", { from, to, total })}</p>
        <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label={t("label")}>
          <button
            type="button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="relative inline-flex items-center rounded-l-md border border-border bg-card px-2 py-2 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="sr-only">{t("prev")}</span>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <span aria-current="page" className="relative inline-flex items-center border border-border bg-card px-4 py-2 text-sm font-semibold">
            {t("page", { page: currentPage, total: totalPages })}
          </span>
          <button
            type="button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="relative inline-flex items-center rounded-r-md border border-border bg-card px-2 py-2 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="sr-only">{t("next")}</span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </nav>
      </div>
    </div>
  );
}
