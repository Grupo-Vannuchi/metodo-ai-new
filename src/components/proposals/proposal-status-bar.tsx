"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { setProposalStatus } from "@/app/actions/proposals";
import type { ProposalStatusKey } from "@/lib/validations/proposal";

const STATUSES: ProposalStatusKey[] = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"];

/** Colour of the currently-active status button. */
const ACTIVE: Record<ProposalStatusKey, string> = {
  DRAFT: "border-transparent bg-slate-500 text-white",
  SENT: "border-transparent bg-brand text-brand-foreground",
  ACCEPTED: "border-transparent bg-green-600 text-white",
  REJECTED: "border-transparent bg-red-600 text-white",
  EXPIRED: "border-transparent bg-amber-600 text-white",
};

/** Side-by-side status buttons on the proposal detail — one-click status change. */
export function ProposalStatusBar({ id, status }: { id: string; status: ProposalStatusKey }) {
  const t = useTranslations("proposals");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pick(next: ProposalStatusKey) {
    if (next === status || pending) return;
    setError(null);
    start(async () => {
      const r = await setProposalStatus(id, next);
      if (r.ok) router.refresh();
      else setError(t("statusError"));
    });
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
            onClick={() => pick(s)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60",
              s === status ? ACTIVE[s] : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {t(`status.${s}`)}
          </button>
        ))}
      </div>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
