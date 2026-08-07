"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  User,
  Building2,
  KanbanSquare,
  MessageCircle,
  Wallet,
  ArrowLeftRight,
  Package,
  ShoppingCart,
  Tag,
  Wrench,
  PackageOpen,
} from "lucide-react";
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

type Href = Parameters<ReturnType<typeof useRouter>["push"]>[0];

/** Quick actions launchable from anywhere. Each navigates to a screen with a
 *  drawer/action auto-opened via URL. Gated by the screen it targets. */
const ACTIONS: { key: string; icon: typeof User; screen: string; href: Href }[] = [
  { key: "newMovement", icon: ArrowLeftRight, screen: "supplies", href: { pathname: "/app/supplies/stock", query: { move: "" } } },
  { key: "newPurchase", icon: ShoppingCart, screen: "supplies", href: "/app/supplies/purchases/new" },
  { key: "newItem", icon: Package, screen: "supplies", href: "/app/supplies/items/new" },
  { key: "newAsset", icon: Tag, screen: "supplies", href: "/app/supplies/assets/new" },
  { key: "scheduleMaintenance", icon: Wrench, screen: "supplies", href: { pathname: "/app/supplies/maintenance", query: { asset: "" } } },
  { key: "receiveEquipment", icon: PackageOpen, screen: "supplies", href: { pathname: "/app/supplies/client-equipment", query: { receive: "1" } } },
];

/** ⌘K / Ctrl+K global search. Rendered once in the shell; opened by the
 * shortcut or a `cmdk:open` window event (dispatched by the trigger buttons). */
export function CommandPalette({ allowedScreens = [] }: { allowedScreens?: string[] }) {
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

  function runAction(href: Href) {
    setOpen(false);
    reset();
    router.push(href);
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
  const termLower = term.toLowerCase();
  const actions = ACTIONS.filter(
    (a) => allowedScreens.includes(a.screen) && (term.length < 2 || t(`actions.${a.key}`).toLowerCase().includes(termLower)),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]" role="dialog" aria-modal="true">
      <button type="button" aria-hidden tabIndex={-1} onClick={() => { setOpen(false); reset(); }} className="absolute inset-0 bg-black/50 backdrop-blur-sm motion-safe:animate-overlay-in" />
      <div className="glass-strong relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/15 shadow-2xl motion-safe:animate-dialog-in">
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
          {actions.length > 0 ? (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                {t("actionsTitle")}
              </p>
              {actions.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => runAction(a.href)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate font-medium">{t(`actions.${a.key}`)}</span>
                  </button>
                );
              })}
            </>
          ) : null}

          {term.length < 2 ? (
            actions.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("hint")}</p>
            ) : null
          ) : loading && results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("searching")}</p>
          ) : results.length === 0 ? (
            actions.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("noResults")}</p>
            ) : null
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
                    "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    i === active ? "bg-muted" : "hover:bg-muted",
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.title}</span>
                    {r.subtitle ? <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span> : null}
                    {r.meta.length > 0 ? (
                      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                        {r.meta.map((m, mi) => (
                          <span key={m} className="flex items-center gap-1.5">
                            {mi > 0 ? <span aria-hidden className="text-muted-foreground/40">•</span> : null}
                            <span className="truncate">{m}</span>
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t(`type.${r.type}`)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
