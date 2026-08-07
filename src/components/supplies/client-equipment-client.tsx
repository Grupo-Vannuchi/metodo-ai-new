"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Wrench, PlayCircle, CheckCircle2, Undo2, Ban, Trash2, X, AlertTriangle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { useNotify } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  createServiceTicket,
  setServiceStatus,
  returnServiceTicket,
  deleteServiceTicket,
} from "@/app/actions/service-tickets";
import type { ServiceTicketRow, ServiceFormOptions } from "@/lib/queries/service-tickets";

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);
const statusCls: Record<string, string> = {
  RECEIVED: "bg-brand/10 text-brand",
  IN_SERVICE: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  READY: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  RETURNED: "bg-muted text-muted-foreground",
  CANCELED: "bg-red-500/10 text-red-600 dark:text-red-400",
};
const TABS = ["ALL", "RECEIVED", "IN_SERVICE", "READY", "RETURNED", "CANCELED"];

export function ClientEquipmentClient({
  tickets,
  options,
}: {
  tickets: ServiceTicketRow[];
  options: ServiceFormOptions;
}) {
  const t = useTranslations("supplies.clientEquipment");
  const locale = useLocale();
  const [statusF, setStatusF] = useState("ALL");
  const [adding, setAdding] = useState(false);
  const df = useMemo(() => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }), [locale]);
  const brl = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }), [locale]);

  const filtered = statusF === "ALL" ? tickets : tickets.filter((tk) => tk.status === statusF);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((skey) => (
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
        <Button type="button" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          {t("receive")}
        </Button>
      </div>

      <Drawer open={adding} onClose={() => setAdding(false)} title={t("receive")}>
        {adding ? <ReceiveForm options={options} onClose={() => setAdding(false)} /> : null}
      </Drawer>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {tickets.length === 0 ? t("empty") : t("noResults")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((tk) => (
            <TicketRow key={tk.id} tk={tk} df={df} brl={brl} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TicketRow({ tk, df, brl }: { tk: ServiceTicketRow; df: Intl.DateTimeFormat; brl: Intl.NumberFormat }) {
  const t = useTranslations("supplies.clientEquipment");
  const router = useRouter();
  const notify = useNotify();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [returning, setReturning] = useState(false);

  const inHouse = tk.status === "RECEIVED" || tk.status === "IN_SERVICE" || tk.status === "READY";
  const canDelete = tk.status === "RETURNED" || tk.status === "CANCELED";

  function transition(action: string) {
    start(async () => {
      await setServiceStatus(tk.id, action);
      notify("statusChanged");
      router.refresh();
    });
  }
  async function onCancel() {
    if (!(await confirm({ description: t("cancelConfirm"), confirmLabel: t("cancelTicket"), variant: "danger" }))) return;
    transition("cancel");
  }
  async function onDelete() {
    if (!(await confirm({ description: t("deleteConfirm"), confirmLabel: t("delete"), variant: "danger" }))) return;
    start(async () => {
      await deleteServiceTicket(tk.id);
      notify("deleted");
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-3",
        tk.overdue && "border-red-500/40 bg-red-500/5",
        tk.status === "CANCELED" && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Wrench className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{tk.equipment}</span>
            {tk.code ? <span className="text-xs text-muted-foreground">OS {tk.code}</span> : null}
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusCls[tk.status])}>
              {t(`status.${tk.status}`)}
            </span>
            {tk.overdue ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                <AlertTriangle className="size-3" />
                {t("overdue")}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            {tk.companyName ? <span>{tk.companyName}</span> : null}
            <span>{t("received", { date: df.format(tk.receivedAt) })}</span>
            {tk.expectedReturn && !tk.returnedAt ? (
              <span className={cn(tk.overdue && "font-medium text-red-600 dark:text-red-400")}>
                {t("expected", { date: df.format(tk.expectedReturn) })}
              </span>
            ) : null}
            {tk.returnedAt ? <span>{t("returnedOn", { date: df.format(tk.returnedAt) })}</span> : null}
            {tk.cost != null ? <span>{brl.format(tk.cost)}</span> : null}
            {tk.responsible ? <span>{tk.responsible}</span> : null}
          </span>
          {tk.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{tk.description}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {tk.status === "RECEIVED" ? (
            <IconBtn onClick={() => transition("start")} disabled={pending} label={t("start")} tone="brand">
              <PlayCircle className="size-4" />
            </IconBtn>
          ) : null}
          {tk.status === "IN_SERVICE" ? (
            <IconBtn onClick={() => transition("ready")} disabled={pending} label={t("markReady")} tone="emerald">
              <CheckCircle2 className="size-4" />
            </IconBtn>
          ) : null}
          {inHouse ? (
            <IconBtn onClick={() => setReturning((v) => !v)} disabled={pending} label={t("return")} tone="brand">
              <Undo2 className="size-4" />
            </IconBtn>
          ) : null}
          {inHouse ? (
            <IconBtn onClick={onCancel} disabled={pending} label={t("cancelTicket")} tone="amber">
              <Ban className="size-4" />
            </IconBtn>
          ) : null}
          {canDelete ? (
            <IconBtn onClick={onDelete} disabled={pending} label={t("delete")} tone="red">
              <Trash2 className="size-4" />
            </IconBtn>
          ) : null}
        </span>
      </div>

      {returning && inHouse ? <ReturnForm ticket={tk} onClose={() => setReturning(false)} /> : null}
    </li>
  );
}

function IconBtn({
  onClick,
  disabled,
  label,
  tone,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  tone: "brand" | "emerald" | "amber" | "red";
  children: React.ReactNode;
}) {
  const hover =
    tone === "emerald"
      ? "hover:text-emerald-600"
      : tone === "amber"
        ? "hover:text-amber-600"
        : tone === "red"
          ? "hover:text-red-600"
          : "hover:text-brand";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn("rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50", hover)}
    >
      {children}
    </button>
  );
}

function ReturnForm({ ticket, onClose }: { ticket: ServiceTicketRow; onClose: () => void }) {
  const t = useTranslations("supplies.clientEquipment");
  const router = useRouter();
  const notify = useNotify();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const input = {
      returnedAt: String(fd.get("returnedAt") ?? ""),
      cost: String(fd.get("cost") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    };
    start(async () => {
      const res = await returnServiceTicket(ticket.id, input);
      if (res.ok) {
        notify("returned");
        onClose();
        router.refresh();
      } else {
        setError(t("actionError"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
      <h3 className="text-sm font-semibold">{t("returnTitle")}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`ret-${ticket.id}`}>{t("returnedAt")}</Label>
          <Input id={`ret-${ticket.id}`} name="returnedAt" type="date" defaultValue={today} />
        </div>
        <div>
          <Label htmlFor={`cost-${ticket.id}`}>{t("cost")}</Label>
          <Input id={`cost-${ticket.id}`} name="cost" type="number" step="0.01" min="0" inputMode="decimal" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`note-${ticket.id}`}>{t("notes")}</Label>
          <Textarea id={`note-${ticket.id}`} name="notes" rows={2} maxLength={2000} />
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("saving") : t("confirmReturn")}
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

function ReceiveForm({ options, onClose }: { options: ServiceFormOptions; onClose: () => void }) {
  const t = useTranslations("supplies.clientEquipment");
  const router = useRouter();
  const notify = useNotify();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const assetById = useMemo(() => new Map(options.assets.map((a) => [a.id, a])), [options.assets]);

  const [assetId, setAssetId] = useState("");
  const [equipment, setEquipment] = useState("");
  const [companyId, setCompanyId] = useState("");

  function pickAsset(id: string) {
    setAssetId(id);
    const a = id ? assetById.get(id) : null;
    if (a) {
      setEquipment(a.name);
      if (a.companyId) setCompanyId(a.companyId);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const input = {
      equipment,
      assetId,
      companyId,
      description: String(fd.get("description") ?? ""),
      receivedAt: String(fd.get("receivedAt") ?? ""),
      expectedReturn: String(fd.get("expectedReturn") ?? ""),
      responsible: String(fd.get("responsible") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    };
    start(async () => {
      const res = await createServiceTicket(input);
      if (res.ok) {
        notify("received");
        onClose();
        router.refresh();
      } else {
        setError(t("actionError"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {options.assets.length > 0 ? (
          <div className="sm:col-span-2">
            <Label htmlFor="rc-asset">{t("asset")}</Label>
            <select id="rc-asset" className={selectCls} value={assetId} onChange={(e) => pickAsset(e.target.value)}>
              <option value="">{t("noAsset")}</option>
              {options.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Label htmlFor="rc-equip">{t("equipment")}</Label>
          <Input id="rc-equip" value={equipment} onChange={(e) => setEquipment(e.target.value)} required maxLength={240} />
        </div>
        <div>
          <Label htmlFor="rc-company">{t("company")}</Label>
          <select id="rc-company" className={selectCls} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">{t("noCompany")}</option>
            {options.companies.map((co) => (
              <option key={co.id} value={co.id}>
                {co.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="rc-resp">{t("responsible")}</Label>
          <Input id="rc-resp" name="responsible" maxLength={160} />
        </div>
        <div>
          <Label htmlFor="rc-received">{t("receivedAt")}</Label>
          <Input id="rc-received" name="receivedAt" type="date" defaultValue={today} required />
        </div>
        <div>
          <Label htmlFor="rc-expected">{t("expectedReturn")}</Label>
          <Input id="rc-expected" name="expectedReturn" type="date" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="rc-desc">{t("description")}</Label>
          <Textarea id="rc-desc" name="description" rows={2} maxLength={2000} placeholder={t("descriptionPlaceholder")} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="rc-notes">{t("notes")}</Label>
          <Textarea id="rc-notes" name="notes" rows={2} maxLength={2000} />
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
