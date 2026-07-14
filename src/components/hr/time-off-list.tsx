"use client";

import { useState, useTransition } from "react";
import { Check, X, Trash2, Plane, Stethoscope, CalendarOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { decideTimeOff, deleteTimeOff } from "@/app/actions/time-off";
import type { TimeOffRow } from "@/lib/queries/time-off";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-500/10 text-amber-600",
  APPROVED: "bg-green-500/10 text-green-600",
  REJECTED: "bg-red-500/10 text-red-600",
};

const TYPE_ICON: Record<string, typeof Plane> = {
  VACATION: Plane,
  SICK: Stethoscope,
  LEAVE: CalendarOff,
  ABSENCE: CalendarOff,
  OTHER: CalendarOff,
};

const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString("pt-BR");

/** Time-off requests with inline approve/reject (pending ones only). */
export function TimeOffList({ rows, canDecide }: { rows: TimeOffRow[]; canDecide: boolean }) {
  const t = useTranslations("hr");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function decide(id: string, status: "APPROVED" | "REJECTED") {
    setError(null);
    setBusyId(id);
    start(async () => {
      const r = await decideTimeOff(id, { status, decisionNote: "" });
      setBusyId(null);
      if (r.ok) router.refresh();
      else setError(t(`timeOff.error.${r.error}`));
    });
  }

  async function remove(id: string) {
    if (!(await confirm({ description: t("timeOff.confirmDelete"), confirmLabel: t("delete"), variant: "danger" }))) return;
    setBusyId(id);
    start(async () => {
      const r = await deleteTimeOff(id);
      setBusyId(null);
      if (r.ok) router.refresh();
      else setError(t("timeOff.error.locked"));
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
        {t("timeOff.empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">{t("timeOff.colEmployee")}</th>
              <th className="px-5 py-3 font-medium">{t("timeOff.colType")}</th>
              <th className="px-5 py-3 font-medium">{t("timeOff.colPeriod")}</th>
              <th className="px-5 py-3 font-medium">{t("timeOff.colDays")}</th>
              <th className="px-5 py-3 font-medium">{t("timeOff.colStatus")}</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const Icon = TYPE_ICON[r.type] ?? CalendarOff;
              const busy = pending && busyId === r.id;
              return (
                <tr key={r.id} className="border-b border-border align-top last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <span className="font-medium">{r.employeeName}</span>
                    {r.reason ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">{r.reason}</span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Icon className="size-4 shrink-0" />
                      {t(`timeOff.type.${r.type}`)}
                    </span>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-muted-foreground">
                    {fmtDate(r.startDate)} — {fmtDate(r.endDate)}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-muted-foreground">
                    {t("timeOff.dayCount", { count: r.days })}
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[r.status])}>
                      {t(`timeOff.status.${r.status}`)}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {r.status === "PENDING" ? (
                      <div className="flex items-center justify-end gap-1">
                        {canDecide ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => decide(r.id, "APPROVED")}
                              title={t("timeOff.approve")}
                              aria-label={t("timeOff.approve")}
                              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-green-600 disabled:opacity-50"
                            >
                              {busy ? <Spinner className="size-4" /> : <Check className="size-4" />}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => decide(r.id, "REJECTED")}
                              title={t("timeOff.reject")}
                              aria-label={t("timeOff.reject")}
                              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
                            >
                              <X className="size-4" />
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void remove(r.id)}
                          title={t("delete")}
                          aria-label={t("delete")}
                          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
