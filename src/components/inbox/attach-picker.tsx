"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckSquare, KanbanSquare, Contact, Building2, Radar, Search, ArrowLeft, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AttachKind, AttachOption } from "@/lib/queries/team-chat";

const TYPES: { kind: AttachKind; icon: typeof CheckSquare }[] = [
  { kind: "TASK", icon: CheckSquare },
  { kind: "OPP", icon: KanbanSquare },
  { kind: "CONTACT", icon: Contact },
  { kind: "COMPANY", icon: Building2 },
  { kind: "LEAD", icon: Radar },
];

/** Modal to pick a CRM entity to attach to a team-chat message. */
export function AttachPicker({
  onPick,
  onClose,
}: {
  onPick: (type: AttachKind, id: string, label: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("teamChat");
  const [kind, setKind] = useState<AttachKind | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AttachOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!kind) return;
    let active = true;
    const id = setTimeout(async () => {
      if (active) setLoading(true);
      try {
        const r = await fetch(`/api/team-chat/attach?type=${kind}&q=${encodeURIComponent(query)}`, { cache: "no-store" });
        if (active && r.ok) setResults(await r.json());
      } catch {
        /* ignore */
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [kind, query]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]" role="dialog" aria-modal="true">
      <button type="button" aria-hidden tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/50 motion-safe:animate-overlay-in" />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-xl motion-safe:animate-dialog-in">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {kind ? (
            <button
              type="button"
              onClick={() => {
                setKind(null);
                setResults([]);
                setQuery("");
              }}
              aria-label={t("back")}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <span className="flex-1 text-sm font-semibold">{kind ? t(`attachType.${kind}`) : t("attachTitle")}</span>
          <button type="button" onClick={onClose} aria-label={t("close")} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {!kind ? (
          <div className="flex flex-col gap-1 p-2">
            {TYPES.map(({ kind: k, icon: Icon }) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
              >
                <Icon className="size-4 shrink-0 text-brand" />
                {t(`attachType.${k}`)}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                placeholder={t("attachSearch")}
                className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
              {loading && results.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">…</p>
              ) : results.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("attachEmpty")}</p>
              ) : (
                results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onPick(kind, r.id, r.label)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{r.label}</span>
                      {r.sublabel ? <span className="block truncate text-xs text-muted-foreground">{r.sublabel}</span> : null}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
