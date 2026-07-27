"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Bookmark, Plus, Trash2, Check } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createSavedView, deleteSavedView } from "@/app/actions/saved-views";
import type { SavedViewRow } from "@/lib/queries/saved-views";

/**
 * Saved board filters. `current` is the querystring for the filters in effect;
 * "save current view" stores it under a name, and picking a view navigates to
 * `/app/crm?<its query>`. Per-user, so one rep's presets don't clutter another's.
 */
export function SavedViews({ current, views }: { current: string; views: SavedViewRow[] }) {
  const t = useTranslations("crm.board.views");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function apply(view: SavedViewRow) {
    setOpen(false);
    router.push(`/app/crm?${view.query}`);
  }

  function save() {
    const label = name.trim();
    if (!label) return;
    setName("");
    setNaming(false);
    start(async () => {
      await createSavedView({ name: label, query: current });
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      await deleteSavedView(id);
      router.refresh();
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Bookmark className="size-4" />
        {t("button")}
        {views.length > 0 ? <span className="text-xs text-muted-foreground">({views.length})</span> : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-border bg-card p-2 shadow-lg">
          {views.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("empty")}</p>
          ) : (
            <div className="flex flex-col">
              {views.map((v) => (
                <div key={v.id} className="group flex items-center gap-1 rounded-lg px-1 transition-colors hover:bg-muted/60">
                  <button
                    type="button"
                    onClick={() => apply(v)}
                    className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm"
                  >
                    {v.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(v.id)}
                    disabled={pending}
                    aria-label={t("remove")}
                    className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={cn("mt-1 border-t border-border pt-1", views.length === 0 && "mt-0 border-0 pt-0")}>
            {naming ? (
              <form
                className="flex items-center gap-1 p-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  save();
                }}
              >
                <input
                  autoFocus
                  value={name}
                  disabled={pending}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
                />
                <Button type="submit" size="sm" disabled={pending || !name.trim()} aria-label={t("save")}>
                  <Check className="size-4" />
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setNaming(true)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-brand transition-colors hover:bg-muted/60"
              >
                <Plus className="size-4" />
                {t("saveCurrent")}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
