"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Check, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Avatar } from "@/components/app/avatar";
import { setGoal } from "@/app/actions/goals";
import type { GoalRow } from "@/lib/queries/goals";

/**
 * Monthly targets vs. achieved (won value) per member. Admins edit a target
 * inline; everyone sees the progress bar.
 */
export function GoalsClient({
  rows,
  month,
  canEdit,
  locale,
}: {
  rows: GoalRow[];
  month: string;
  canEdit: boolean;
  locale: string;
}) {
  const t = useTranslations("crm.goals");
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();

  const brl = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

  function save(userId: string) {
    const target = Number(value.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
    setEditing(null);
    if (!Number.isFinite(target)) return;
    start(async () => {
      await setGoal({ userId, month, targetValue: target });
      router.refresh();
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-3 font-medium">{t("member")}</th>
            <th className="px-5 py-3 font-medium">{t("target")}</th>
            <th className="px-5 py-3 font-medium">{t("achieved")}</th>
            <th className="w-1/3 px-5 py-3 font-medium">{t("progress")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = r.target > 0 ? Math.min(100, Math.round((r.achieved / r.target) * 100)) : 0;
            const reached = r.target > 0 && r.achieved >= r.target;
            return (
              <tr key={r.userId} className="border-b border-border last:border-0">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={r.name} src={r.avatarUrl} className="size-8 shrink-0 text-xs" />
                    <span className="truncate font-medium">{r.name}</span>
                  </div>
                </td>
                <td className="px-5 py-3">
                  {editing === r.userId ? (
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        save(r.userId);
                      }}
                    >
                      <input
                        autoFocus
                        value={value}
                        disabled={pending}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                        inputMode="numeric"
                        className="h-8 w-28 rounded-md border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
                      />
                      <button type="submit" disabled={pending} className="text-muted-foreground hover:text-foreground" aria-label={t("save")}>
                        <Check className="size-4" />
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground" aria-label={t("cancel")}>
                        <X className="size-4" />
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => {
                        setValue(r.target ? String(Math.round(r.target)) : "");
                        setEditing(r.userId);
                      }}
                      className="group inline-flex items-center gap-1.5 disabled:cursor-default"
                    >
                      <span>{r.target > 0 ? brl.format(r.target) : "—"}</span>
                      {canEdit ? <Pencil className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" /> : null}
                    </button>
                  )}
                </td>
                <td className="px-5 py-3 font-medium">{brl.format(r.achieved)}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={reached ? "h-full rounded-full bg-green-500" : "h-full rounded-full bg-brand"}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">{r.target > 0 ? `${pct}%` : "—"}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
