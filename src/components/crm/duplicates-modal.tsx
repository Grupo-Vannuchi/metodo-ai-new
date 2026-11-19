"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { CopyCheck, Merge, X, Phone, Mail, Hash, Type } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DupGroup } from "@/lib/queries/duplicates";
import { dupGroupKey, primaryFor } from "@/lib/crm/duplicates-pick";
import { mergeContacts, mergeCompanies } from "@/app/actions/merge";

const REASON_ICON = { phone: Phone, email: Mail, cnpj: Hash, name: Type } as const;

export function DuplicatesModal({
  entity,
  groups,
}: {
  entity: "contacts" | "companies";
  groups: DupGroup[];
}) {
  const t = useTranslations("crm.dupes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Picks are keyed by the group (dupGroupKey), never by its position in the list: a merge removes a
  // group and the ones below move up, and a pick stored by position would land on another group.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const count = groups.length;

  function merge(g: DupGroup) {
    const key = dupGroupKey(g);
    const primaryId = primaryFor(g, picked[key]);
    const losers = g.records.map((r) => r.id).filter((id) => id !== primaryId);
    if (losers.length === 0) return;
    setBusyKey(key);
    setFailedKey(null);
    start(async () => {
      const fn = entity === "contacts" ? mergeContacts : mergeCompanies;
      const res = await fn(primaryId, losers);
      setBusyKey(null);
      if (!res.ok) {
        setFailedKey(key);
        return;
      }
      setPicked((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
      >
        <CopyCheck className="size-4" />
        {t("button")}
        {count > 0 ? (
          <span className="rounded-full bg-amber-500/20 px-1.5 text-xs font-semibold text-amber-600">{count}</span>
        ) : null}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
              <button
                type="button"
                tabIndex={-1}
                aria-label={t("close")}
                onClick={() => (pending ? null : setOpen(false))}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm motion-safe:animate-overlay-in"
              />
              <div className="glass-strong relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/15 shadow-2xl motion-safe:animate-dialog-in">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div className="flex items-center gap-2">
                    <CopyCheck className="size-5 text-brand" />
                    <h2 className="text-base font-semibold">{t("title")}</h2>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="text-muted-foreground hover:text-foreground">
                    <X className="size-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {count === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">{t("none")}</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">{t("hint")}</p>
                      <div className="mt-4 flex flex-col gap-4">
                        {groups.map((g) => {
                          const Icon = REASON_ICON[g.reason];
                          const key = dupGroupKey(g);
                          const chosen = primaryFor(g, picked[key]);
                          return (
                            <div key={key} className="rounded-xl border border-border bg-card/50 p-3">
                              <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Icon className="size-3.5" />
                                {t(`by.${g.reason}`)}
                              </div>
                              <div className="flex flex-col gap-1.5">
                                {g.records.map((r) => (
                                  <label
                                    key={r.id}
                                    className={cn(
                                      "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors",
                                      chosen === r.id ? "border-brand bg-brand/5" : "border-border hover:bg-muted/40",
                                    )}
                                  >
                                    <input
                                      type="radio"
                                      name={`primary-${key}`}
                                      checked={chosen === r.id}
                                      onChange={() => setPicked((p) => ({ ...p, [key]: r.id }))}
                                      className="size-4 shrink-0 accent-[var(--brand)]"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium">{r.name}</p>
                                      <p className="truncate text-xs text-muted-foreground">
                                        {[r.subtitle, r.detail].filter(Boolean).join(" · ") || "—"}
                                      </p>
                                    </div>
                                    {r.deals > 0 ? (
                                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                        {t("deals", { n: r.deals })}
                                      </span>
                                    ) : null}
                                    {chosen === r.id ? (
                                      <span className="shrink-0 text-xs font-medium text-brand">{t("keep")}</span>
                                    ) : null}
                                  </label>
                                ))}
                              </div>
                              <div className="mt-2 flex items-center justify-end gap-3">
                                {failedKey === key ? (
                                  <p role="alert" className="text-xs text-red-600">
                                    {t("error")}
                                  </p>
                                ) : null}
                                <Button type="button" size="sm" disabled={pending} onClick={() => merge(g)}>
                                  <Merge className="size-4" />
                                  {busyKey === key ? t("merging") : t("mergeBtn", { n: g.records.length })}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
