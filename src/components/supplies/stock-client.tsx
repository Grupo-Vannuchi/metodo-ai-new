"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Plus,
  Search,
  ArrowDownToLine,
  ArrowUpFromLine,
  SlidersHorizontal,
  ArrowLeftRight,
  RotateCcw,
  X,
  AlertTriangle,
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { createStockMovement, reverseStockMovement } from "@/app/actions/stock";
import type { StockBalanceRow, StockMovementRow, StockFormOptions } from "@/lib/queries/stock";

type Kind = "IN" | "OUT" | "ADJUST" | "TRANSFER";
type Tab = "balances" | "movements";

const KINDS: { kind: Kind; icon: typeof Plus }[] = [
  { kind: "IN", icon: ArrowDownToLine },
  { kind: "OUT", icon: ArrowUpFromLine },
  { kind: "ADJUST", icon: SlidersHorizontal },
  { kind: "TRANSFER", icon: ArrowLeftRight },
];

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

export function StockClient({
  balances,
  movements,
  options,
}: {
  balances: StockBalanceRow[];
  movements: StockMovementRow[];
  options: StockFormOptions;
}) {
  const t = useTranslations("supplies.stock");
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>("balances");
  const [adding, setAdding] = useState(false);
  const nf = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }), [locale]);
  const canMove = options.items.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(["balances", "movements"] as const).map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setTab(x)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                tab === x ? "bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t(`tab.${x}`)}
            </button>
          ))}
        </div>
        {!adding && canMove ? (
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t("new")}
          </Button>
        ) : null}
      </div>

      {!canMove ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t("noItems")}
        </p>
      ) : null}

      {adding ? (
        <MovementForm options={options} onClose={() => setAdding(false)} />
      ) : null}

      {tab === "balances" ? (
        <Balances rows={balances} nf={nf} />
      ) : (
        <Movements rows={movements} nf={nf} locale={locale} />
      )}
    </div>
  );
}

function Balances({ rows, nf }: { rows: StockBalanceRow[]; nf: Intl.NumberFormat }) {
  const t = useTranslations("supplies.stock");
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const filtered = term
    ? rows.filter((r) => r.description.toLowerCase().includes(term) || (r.code ?? "").toLowerCase().includes(term))
    : rows;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-9 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-sm focus-visible:border-brand focus-visible:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? t("emptyBalances") : t("noResults")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((r) => (
            <li
              key={r.itemId}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border bg-card p-3",
                r.belowMin && "border-amber-500/40 bg-amber-500/5",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{r.description}</span>
                  {r.code ? <span className="text-xs text-muted-foreground">{r.code}</span> : null}
                  {r.belowMin ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="size-3" />
                      {t("belowMin")}
                    </span>
                  ) : null}
                </span>
                {r.minStock != null ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t("min")}: {nf.format(r.minStock)}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    r.balance < 0 ? "text-red-600" : r.belowMin ? "text-amber-600 dark:text-amber-400" : "text-foreground",
                  )}
                >
                  {nf.format(r.balance)}
                </span>
                {r.unit ? <span className="ml-1 text-xs text-muted-foreground">{r.unit}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Movements({ rows, nf, locale }: { rows: StockMovementRow[]; nf: Intl.NumberFormat; locale: string }) {
  const t = useTranslations("supplies.stock");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const df = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  async function onReverse(row: StockMovementRow) {
    if (!(await confirm({ description: t("reverseConfirm"), confirmLabel: t("reverse"), variant: "danger" }))) return;
    start(async () => {
      await reverseStockMovement(row.id);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {t("emptyMovements")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((m) => (
        <li
          key={m.id}
          className={cn("flex items-center gap-3 rounded-lg border border-border bg-card p-3", m.reversed && "opacity-50")}
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{m.itemDescription}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t(`type.${m.type}`)}
              </span>
              {m.reversed ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t("reversedTag")}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <span>{df.format(m.createdAt)}</span>
              {m.warehouseName ? <span>{m.warehouseName}</span> : null}
              {m.reason ? <span>{m.reason}</span> : null}
              {m.reference ? <span>{m.reference}</span> : null}
            </span>
          </span>
          <span className={cn("shrink-0 text-sm font-semibold tabular-nums", m.qty < 0 ? "text-red-600" : "text-emerald-600")}>
            {m.qty > 0 ? "+" : ""}
            {nf.format(m.qty)}
          </span>
          {!m.reversed ? (
            <button
              type="button"
              onClick={() => onReverse(m)}
              disabled={pending}
              aria-label={t("reverse")}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
            >
              <RotateCcw className="size-4" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function MovementForm({ options, onClose }: { options: StockFormOptions; onClose: () => void }) {
  const t = useTranslations("supplies.stock");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<Kind>("IN");
  const [error, setError] = useState<string | null>(null);
  const hasWarehouses = options.warehouses.length > 0;
  const isTransfer = kind === "TRANSFER";
  const isAdjust = kind === "ADJUST";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const input = {
      kind,
      itemId: String(fd.get("itemId") ?? ""),
      warehouseId: String(fd.get("warehouseId") ?? ""),
      toWarehouseId: String(fd.get("toWarehouseId") ?? ""),
      quantity: String(fd.get("quantity") ?? ""),
      adjustDirection: String(fd.get("adjustDirection") ?? "increase"),
      lot: String(fd.get("lot") ?? ""),
      validity: String(fd.get("validity") ?? ""),
      unitCost: String(fd.get("unitCost") ?? ""),
      reason: String(fd.get("reason") ?? ""),
      reference: String(fd.get("reference") ?? ""),
      note: String(fd.get("note") ?? ""),
    };
    start(async () => {
      const r = await createStockMovement(input);
      if (r.ok) {
        onClose();
        router.refresh();
      } else if (r.error === "insufficient") {
        setError(t("insufficient", { available: r.available ?? 0 }));
      } else {
        setError(t("saveError"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      {/* Movement kind */}
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => setKind(k.kind)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
              kind === k.kind
                ? "border-brand bg-brand/10 font-medium text-brand"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            <k.icon className="size-4" />
            {t(`kind.${k.kind}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="itemId">{t("field.item")}</Label>
          <select id="itemId" name="itemId" required className={selectCls} defaultValue="">
            <option value="" disabled>
              {t("field.itemPlaceholder")}
            </option>
            {options.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </div>

        {hasWarehouses ? (
          <div>
            <Label htmlFor="warehouseId">{isTransfer ? t("field.fromWarehouse") : t("field.warehouse")}</Label>
            <select
              id="warehouseId"
              name="warehouseId"
              required={isTransfer}
              className={selectCls}
              defaultValue=""
            >
              <option value="">{isTransfer ? t("field.selectWarehouse") : t("field.noWarehouse")}</option>
              {options.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="warehouseId" value="" />
        )}

        {isTransfer && hasWarehouses ? (
          <div>
            <Label htmlFor="toWarehouseId">{t("field.toWarehouse")}</Label>
            <select id="toWarehouseId" name="toWarehouseId" required className={selectCls} defaultValue="">
              <option value="">{t("field.selectWarehouse")}</option>
              {options.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <Label htmlFor="quantity">{t("field.quantity")}</Label>
          <Input id="quantity" name="quantity" type="number" step="0.001" min="0" required inputMode="decimal" />
        </div>

        {isAdjust ? (
          <div>
            <Label htmlFor="adjustDirection">{t("field.direction")}</Label>
            <select id="adjustDirection" name="adjustDirection" className={selectCls} defaultValue="increase">
              <option value="increase">{t("field.increase")}</option>
              <option value="decrease">{t("field.decrease")}</option>
            </select>
          </div>
        ) : null}

        {kind === "IN" ? (
          <div>
            <Label htmlFor="unitCost">{t("field.unitCost")}</Label>
            <Input id="unitCost" name="unitCost" type="number" step="0.01" min="0" inputMode="decimal" />
          </div>
        ) : null}

        <div>
          <Label htmlFor="reason">{t("field.reason")}</Label>
          <Input id="reason" name="reason" maxLength={160} placeholder={t("field.reasonPlaceholder")} />
        </div>

        <div>
          <Label htmlFor="reference">{t("field.reference")}</Label>
          <Input id="reference" name="reference" maxLength={160} placeholder={t("field.referencePlaceholder")} />
        </div>

        <div>
          <Label htmlFor="lot">{t("field.lot")}</Label>
          <Input id="lot" name="lot" maxLength={80} />
        </div>

        <div>
          <Label htmlFor="validity">{t("field.validity")}</Label>
          <Input id="validity" name="validity" type="date" />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="note">{t("field.note")}</Label>
          <Textarea id="note" name="note" rows={2} maxLength={500} />
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
