"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, User, Building2, KanbanSquare, MessageCircle, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { SearchResult, SearchType } from "@/lib/queries/search";

const ICON: Record<SearchType, typeof User> = {
  contact: User,
  company: Building2,
  opportunity: KanbanSquare,
  conversation: MessageCircle,
  finance: Wallet,
};

/** ⌘K / Ctrl+K global search. Rendered once in the shell; opened by the
 * shortcut or a `cmdk:open` window event (dispatched by the trigger buttons). */
export function CommandPalette() {
  const t = useTranslations("search");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resetting on every open/close keeps state changes inside event handlers,
  // not synchronously inside effects (which triggers cascading renders).
  const reset = useCallback(() => {
    setQ("");
    setResults([]);
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        reset();
      } else if (e.key === "Escape") {
        setOpen(false);
        reset();
      }
    };
    const onOpen = () => {
      setOpen(true);
      reset();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("cmdk:open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cmdk:open", onOpen);
    };
  }, [reset]);

  // Focus only — no setState — so the effect can't cascade.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // All state updates happen inside the (async) timeout, never synchronously
  // in the effect body.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    let activeReq = true;
    const id = setTimeout(async () => {
      if (term.length < 2) {
        if (activeReq) setResults([]);
        return;
      }
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        if (activeReq && r.ok) {
          setResults(await r.json());
          setActive(0);
        }
      } catch {
        /* ignore */
      } finally {
        if (activeReq) setLoading(false);
      }
    }, term.length < 2 ? 0 : 250);
    return () => {
      activeReq = false;
      clearTimeout(id);
    };
  }, [q, open]);

  function go(r: SearchResult) {
    setOpen(false);
    reset();
    router.push(r.href);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active]);
    }
  }

  if (!open) return null;

  const term = q.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]" role="dialog" aria-modal="true">
      <button type="button" aria-hidden tabIndex={-1} onClick={() => { setOpen(false); reset(); }} className="absolute inset-0 bg-black/50 motion-safe:animate-overlay-in" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-xl motion-safe:animate-dialog-in">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder={t("placeholder")}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {term.length < 2 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("hint")}</p>
          ) : loading && results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("searching")}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("noResults")}</p>
          ) : (
            results.map((r, i) => {
              const Icon = ICON[r.type];
              return (
                <button
                  key={`${r.type}-${r.id}`}
                  type="button"
                  onClick={() => go(r)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    i === active ? "bg-muted" : "hover:bg-muted",
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.title}</span>
                    {r.subtitle ? <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span> : null}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{t(`type.${r.type}`)}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
