"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Wrench, Gauge, Check, Ban, Trash2, X, AlertTriangle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  scheduleMaintenance,
  completeMaintenance,
  cancelMaintenance,
  deleteMaintenance,
} from "@/app/actions/maintenance";
import type { MaintenanceEventRow, MaintenanceFormOptions } from "@/lib/queries/maintenance";

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);
const typeIcon: Record<string, typeof Wrench> = { MAINTENANCE: Wrench, CALIBRATION: Gauge };
const statusCls: Record<string, string> = {
  SCHEDULED: "bg-brand/10 text-brand",
  DONE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  CANCELED: "bg-muted text-muted-foreground",
};

export function MaintenanceClient({
  events,
  options,
}: {
  events: MaintenanceEventRow[];
  options: MaintenanceFormOptions;
}) {
  const t = useTranslations("supplies.maintenance");
  const locale = useLocale();
  const [statusF, setStatusF] = useState("ALL");
  const [typeF, setTypeF] = useState("ALL");
  const [adding, setAdding] = useState(false);
  const df = useMemo(() => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }), [locale]);
  const brl = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }), [locale]);
  const canSchedule = options.assets.length > 0;

  const filtered = events.filter(
    (e) => (statusF === "ALL" || e.status === statusF) && (typeF === "ALL" || e.type === typeF),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {["ALL", "SCHEDULED", "DONE", "CANCELED"].map((skey) => (
              <button
                key={skey}
                type="button"
                onClick={() => setStatusF(skey)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  statusF === skey ? "bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {skey === "ALL" ? t("all") : t(`status.${skey}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {["ALL", "MAINTENANCE", "CALIBRATION"].map((tk) => (
              <button
                key={tk}
                type="button"
                onClick={() => setTypeF(tk)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs transition-colors",
                  typeF === tk ? "bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {tk === "ALL" ? t("allTypes") : t(`type.${tk}`)}
              </button>
            ))}
          </div>
        </div>
        {!adding && canSchedule ? (
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t("schedule")}
          </Button>
        ) : null}
      </div>

      {!canSchedule ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t("noAssets")}
        </p>
      ) : null}

      {adding ? <ScheduleForm options={options} onClose={() => setAdding(false)} /> : null}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {events.length === 0 ? t("empty") : t("noResults")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((e) => (
            <EventRow key={e.id} e={e} df={df} brl={brl} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EventRow({ e, df, brl }: { e: MaintenanceEventRow; df: Intl.DateTimeFormat; brl: Intl.NumberFormat }) {
  const t = useTranslations("supplies.maintenance");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [completing, setCompleting] = useState(false);
  const Icon = typeIcon[e.type] ?? Wrench;
  const isScheduled = e.status === "SCHEDULED";

  async function onCancel() {
    if (!(await confirm({ description: t("cancelConfirm"), confirmLabel: t("cancelEvent"), variant: "danger" }))) return;
    start(async () => {
      await cancelMaintenance(e.id);
      router.refresh();
    });
  }
  async function onDelete() {
    if (!(await confirm({ description: t("deleteConfirm"), confirmLabel: t("delete"), variant: "danger" }))) return;
    start(async () => {
      await deleteMaintenance(e.id);
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-3",
        e.overdue && "border-red-500/40 bg-red-500/5",
        e.status === "CANCELED" && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{e.assetName}</span>
            {e.assetCode ? <span className="text-xs text-muted-foreground">{e.assetCode}</span> : null}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t(`type.${e.type}`)}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusCls[e.status])}>
              {t(`status.${e.status}`)}
            </span>
            {e.overdue ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                <AlertTriangle className="size-3" />
                {t("overdue")}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span className={cn(e.overdue && "font-medium text-red-600 dark:text-red-400")}>
              {isScheduled ? t("due", { date: df.format(e.dueDate) }) : t("performed", { date: df.format(e.performedAt ?? e.dueDate) })}
            </span>
            {e.provider ? <span>{e.provider}</span> : null}
            {e.cost != null ? <span>{brl.format(e.cost)}</span> : null}
            {e.certificate ? <span>{t("cert")}: {e.certificate}</span> : null}
            {e.result ? <span>{e.result}</span> : null}
          </span>
        </span>
        {isScheduled ? (
          <span className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setCompleting((v) => !v)}
              disabled={pending}
              aria-label={t("complete")}
              title={t("complete")}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-emerald-600 disabled:opacity-50"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              aria-label={t("cancelEvent")}
              title={t("cancelEvent")}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-amber-600 disabled:opacity-50"
            >
              <Ban className="size-4" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            aria-label={t("delete")}
            title={t("delete")}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      {completing && isScheduled ? <CompleteForm event={e} onClose={() => setCompleting(false)} /> : null}
    </li>
  );
}

function CompleteForm({ event, onClose }: { event: MaintenanceEventRow; onClose: () => void }) {
  const t = useTranslations("supplies.maintenance");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const isCalibration = event.type === "CALIBRATION";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const input = {
      performedAt: String(fd.get("performedAt") ?? ""),
      provider: String(fd.get("provider") ?? ""),
      cost: String(fd.get("cost") ?? ""),
      certificate: String(fd.get("certificate") ?? ""),
      result: String(fd.get("result") ?? ""),
      notes: String(fd.get("notes") ?? ""),
      autoNext: fd.get("autoNext") === "on",
    };
    start(async () => {
      const res = await completeMaintenance(event.id, input);
      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        setError(t("actionError"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
      <h3 className="text-sm font-semibold">{t("completeTitle")}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`perf-${event.id}`}>{t("performedAt")}</Label>
          <Input id={`perf-${event.id}`} name="performedAt" type="date" defaultValue={today} />
        </div>
        <div>
          <Label htmlFor={`prov-${event.id}`}>{t("provider")}</Label>
          <Input id={`prov-${event.id}`} name="provider" defaultValue={event.provider ?? ""} maxLength={160} />
        </div>
        <div>
          <Label htmlFor={`cost-${event.id}`}>{t("cost")}</Label>
          <Input id={`cost-${event.id}`} name="cost" type="number" step="0.01" min="0" inputMode="decimal" />
        </div>
        {isCalibration ? (
          <div>
            <Label htmlFor={`cert-${event.id}`}>{t("certificate")}</Label>
            <Input id={`cert-${event.id}`} name="certificate" maxLength={120} />
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Label htmlFor={`res-${event.id}`}>{t("result")}</Label>
          <Input id={`res-${event.id}`} name="result" maxLength={500} placeholder={t("resultPlaceholder")} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`note-${event.id}`}>{t("notes")}</Label>
          <Textarea id={`note-${event.id}`} name="notes" rows={2} maxLength={2000} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="autoNext" defaultChecked className="size-4 accent-brand" />
        {t("autoNext")}
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("saving") : t("confirmComplete")}
        </Button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

function ScheduleForm({ options, onClose }: { options: MaintenanceFormOptions; onClose: () => void }) {
  const t = useTranslations("supplies.maintenance");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const input = {
      assetId: String(fd.get("assetId") ?? ""),
      type: String(fd.get("type") ?? "MAINTENANCE"),
      dueDate: String(fd.get("dueDate") ?? ""),
      provider: String(fd.get("provider") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    };
    start(async () => {
      const res = await scheduleMaintenance(input);
      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        setError(t("actionError"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="sch-asset">{t("asset")}</Label>
          <select id="sch-asset" name="assetId" required className={selectCls} defaultValue="">
            <option value="" disabled>
              {t("assetPlaceholder")}
            </option>
            {options.assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="sch-type">{t("typeLabel")}</Label>
          <select id="sch-type" name="type" className={selectCls} defaultValue="MAINTENANCE">
            <option value="MAINTENANCE">{t("type.MAINTENANCE")}</option>
            <option value="CALIBRATION">{t("type.CALIBRATION")}</option>
          </select>
        </div>
        <div>
          <Label htmlFor="sch-due">{t("dueDate")}</Label>
          <Input id="sch-due" name="dueDate" type="date" required />
        </div>
        <div>
          <Label htmlFor="sch-prov">{t("provider")}</Label>
          <Input id="sch-prov" name="provider" maxLength={160} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="sch-note">{t("notes")}</Label>
          <Textarea id="sch-note" name="notes" rows={2} maxLength={2000} />
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
