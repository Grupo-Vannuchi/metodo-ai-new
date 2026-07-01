"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { setOpportunityStatus, type OppStatus } from "@/app/actions/opportunities";

const STATUSES: OppStatus[] = ["OPEN", "ON_HOLD", "WON", "LOST", "CANCELED"];

/** Colour of the currently-active status button. */
const ACTIVE: Record<OppStatus, string> = {
  OPEN: "border-transparent bg-brand text-brand-foreground",
  ON_HOLD: "border-transparent bg-amber-500 text-white",
  WON: "border-transparent bg-green-600 text-white",
  LOST: "border-transparent bg-red-600 text-white",
  CANCELED: "border-transparent bg-amber-600 text-white",
};

/**
 * Side-by-side status buttons on the opportunity detail — change status in one
 * click (no full form). LOST/CANCELED reveal an inline reason field first.
 */
export function OpportunityStatusBar({ id, status }: { id: string; status: OppStatus }) {
  const t = useTranslations("crm.opportunity");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<OppStatus | null>(null);
  const [reason, setReason] = useState("");

  function apply(next: OppStatus, reasonText?: string) {
    setError(null);
    start(async () => {
      const r = await setOpportunityStatus(id, next, reasonText);
      if (r.ok) {
        setReasonFor(null);
        setReason("");
        router.refresh();
      } else {
        setError(t("statusError"));
      }
    });
  }

  function onPick(next: OppStatus) {
    if (next === status || pending) return;
    // Lost/canceled need a reason — reveal the inline field first.
    if (next === "LOST" || next === "CANCELED") {
      setReasonFor(next);
      setReason("");
      return;
    }
    apply(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{t("changeStatus")}</p>
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => onPick(s)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60",
              s === status ? ACTIVE[s] : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {t(`status${s}`)}
          </button>
        ))}
      </div>

      {reasonFor ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            className="h-9 min-w-48 flex-1 rounded-md border border-border bg-card px-2.5 text-sm focus-visible:border-brand focus-visible:outline-none"
          />
          <button
            type="button"
            disabled={pending || !reason.trim()}
            onClick={() => apply(reasonFor, reason.trim())}
            className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-foreground disabled:opacity-50"
          >
            {t("confirm")}
          </button>
          <button
            type="button"
            onClick={() => setReasonFor(null)}
            className="h-9 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {t("back")}
          </button>
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
