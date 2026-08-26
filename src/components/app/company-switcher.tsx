"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Building2, ChevronsUpDown, Check, Plus, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { switchCompany, createCompany } from "@/app/actions/account-companies";

type Company = { id: string; name: string; slug: string; activeModules: number };

/**
 * Account company switcher (sidebar, owner-only). Shows the current company and
 * a dropdown to switch between the account's companies or create a new one. The
 * menu is portaled to escape the sidebar's color scope and clipping.
 */
export function CompanySwitcher({
  companies,
  currentId,
  currentName,
  canCreate,
}: {
  companies: Company[];
  currentId: string;
  currentName: string;
  canCreate: boolean;
}) {
  const t = useTranslations("companies");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current && !triggerRef.current.contains(target) && !(target as HTMLElement).closest?.("[data-company-menu]")) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    setOpen((o) => !o);
    setCreating(false);
    setError(null);
  }

  function onSwitch(id: string) {
    if (id === currentId) {
      setOpen(false);
      return;
    }
    start(async () => {
      const r = await switchCompany(id);
      if (r.ok) {
        setOpen(false);
        router.push("/app");
        router.refresh();
      }
    });
  }

  function onCreate() {
    const n = name.trim();
    if (n.length < 2) return;
    setError(null);
    start(async () => {
      const r = await createCompany(n);
      if (r.ok) {
        setOpen(false);
        setCreating(false);
        setName("");
        router.push("/app");
        router.refresh();
      } else {
        setError(t(`error.${r.error}`));
      }
    });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/70"
      >
        <Building2 className="size-4 shrink-0 opacity-80" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{currentName}</span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-70" />
      </button>

      {open && rect
        ? createPortal(
            <div
              data-company-menu
              style={{ position: "fixed", top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 240), zIndex: 60 }}
              className="glass-strong overflow-hidden rounded-xl border border-border shadow-2xl motion-safe:animate-dialog-in"
            >
              <p className="px-3 pb-1 pt-2.5 text-xs font-medium text-muted-foreground">{t("switchTitle")}</p>
              <div className="max-h-64 overflow-y-auto p-1">
                {companies.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={pending}
                    onClick={() => onSwitch(c.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Building2 className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">{t("moduleCount", { count: c.activeModules })}</span>
                    </span>
                    {c.id === currentId ? <Check className="size-4 shrink-0 text-brand" /> : null}
                  </button>
                ))}
              </div>

              <div className="border-t border-border p-1">
                {creating ? (
                  <div className="flex flex-col gap-1.5 p-1.5">
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); onCreate(); }
                      }}
                      maxLength={120}
                      placeholder={t("namePlaceholder")}
                      className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm focus-visible:border-brand focus-visible:outline-none"
                    />
                    {error ? <p className="text-xs text-red-500">{error}</p> : null}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={pending || name.trim().length < 2}
                        onClick={onCreate}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-medium text-brand-foreground disabled:opacity-50"
                      >
                        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                        {t("create")}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setCreating(false); setError(null); setName(""); }}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                        aria-label={t("cancel")}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ) : canCreate ? (
                  <button
                    type="button"
                    onClick={() => { setCreating(true); setError(null); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-brand transition-colors hover:bg-muted"
                  >
                    <Plus className="size-4" />
                    {t("newCompany")}
                  </button>
                ) : (
                  <p className="px-2.5 py-2 text-xs text-muted-foreground">{t("limitReached")}</p>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
