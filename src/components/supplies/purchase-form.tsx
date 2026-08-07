"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Trash2, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { useNotify } from "@/components/ui/toast";
import { createPurchaseOrder, updatePurchaseOrder } from "@/app/actions/purchases";
import type { PurchaseFormOptions, PurchaseOrderDetail } from "@/lib/queries/purchases";

type Row = { key: number; itemId: string; description: string; quantity: string; unitPrice: string };

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

export function PurchaseForm({ options, initial }: { options: PurchaseFormOptions; initial?: PurchaseOrderDetail }) {
  const t = useTranslations("supplies.purchases");
  const locale = useLocale();
  const router = useRouter();
  const notify = useNotify();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const brl = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }), [locale]);

  const itemById = useMemo(() => new Map(options.items.map((i) => [i.id, i])), [options.items]);

  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? "");
  const [expectedAt, setExpectedAt] = useState(
    initial?.expectedAt ? new Date(initial.expectedAt).toISOString().slice(0, 10) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    initial && initial.items.length
      ? initial.items.map((i, idx) => ({
          key: idx,
          itemId: i.itemId ?? "",
          description: i.description,
          quantity: String(i.quantity),
          unitPrice: String(i.unitPrice),
        }))
      : [{ key: 0, itemId: "", description: "", quantity: "1", unitPrice: "" }],
  );
  // Next stable key for rows added after mount (initial rows use their index).
  const keyRef = useRef(initial && initial.items.length ? initial.items.length : 1);

  const grandTotal = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);

  function addRow() {
    setRows((rs) => [...rs, { key: keyRef.current++, itemId: "", description: "", quantity: "1", unitPrice: "" }]);
  }
  function removeRow(key: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  }
  function patchRow(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function pickItem(key: number, itemId: string) {
    const it = itemId ? itemById.get(itemId) : null;
    patchRow(key, {
      itemId,
      ...(it
        ? {
            description: it.description,
            unitPrice: it.lastCost != null && it.lastCost > 0 ? String(it.lastCost) : undefined,
          }
        : {}),
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const items = rows
      .filter((r) => r.description.trim() && Number(r.quantity) > 0)
      .map((r) => ({
        itemId: r.itemId,
        description: r.description.trim(),
        quantity: r.quantity,
        unitPrice: r.unitPrice || "0",
      }));
    if (!items.length) {
      setError(t("errNoItems"));
      return;
    }
    const input = { supplierId, warehouseId, expectedAt, notes, items };
    start(async () => {
      const res = initial ? await updatePurchaseOrder(initial.id, input) : await createPurchaseOrder(input);
      if (res.ok) {
        notify("saved");
        router.push(`/app/supplies/purchases/${res.id}`);
        router.refresh();
      } else {
        setError(t("saveError"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="supplierId">{t("supplier")}</Label>
          <select
            id="supplierId"
            className={selectCls}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">{t("noSupplier")}</option>
            {options.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="warehouseId">{t("warehouse")}</Label>
          <select
            id="warehouseId"
            className={selectCls}
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">{t("noWarehouse")}</option>
            {options.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="expectedAt">{t("expectedAt")}</Label>
          <Input id="expectedAt" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
        </div>
      </div>

      {/* Line items */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("items")}</h2>
          <Button type="button" size="sm" variant="outline" onClick={addRow}>
            <Plus className="size-4" />
            {t("addLine")}
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const unit = r.itemId ? itemById.get(r.itemId)?.unit : null;
            const lineTotal = (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0);
            return (
              <div key={r.key} className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-12">
                <div className="sm:col-span-5">
                  <select className={selectCls} value={r.itemId} onChange={(e) => pickItem(r.key, e.target.value)}>
                    <option value="">{t("freeLine")}</option>
                    {options.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="mt-2"
                    placeholder={t("description")}
                    value={r.description}
                    maxLength={240}
                    onChange={(e) => patchRow(r.key, { description: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    inputMode="decimal"
                    placeholder={t("qty")}
                    value={r.quantity}
                    onChange={(e) => patchRow(r.key, { quantity: e.target.value })}
                  />
                  {unit ? <span className="mt-1 block text-center text-[10px] text-muted-foreground">{unit}</span> : null}
                </div>
                <div className="sm:col-span-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder={t("unitPrice")}
                    value={r.unitPrice}
                    onChange={(e) => patchRow(r.key, { unitPrice: e.target.value })}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 sm:col-span-3">
                  <span className="text-sm font-medium tabular-nums">{brl.format(lineTotal)}</span>
                  <button
                    type="button"
                    onClick={() => removeRow(r.key)}
                    aria-label={t("removeLine")}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
                    disabled={rows.length <= 1}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-1">
          <span className="text-sm text-muted-foreground">
            {t("total")}: <span className="ml-1 text-base font-semibold text-foreground tabular-nums">{brl.format(grandTotal)}</span>
          </span>
        </div>
      </div>

      <div>
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea id="notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
