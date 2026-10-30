"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import {
  createProductService,
  updateProductService,
  deleteProductService,
} from "@/app/actions/product-services";
import type { ProductServiceRow } from "@/lib/queries/crm";

type Kind = "PRODUCT" | "SERVICE";
type Filter = "ALL" | Kind;
type Result = { ok: boolean; error?: string };

function buildForm(fields: { name: string; kind: Kind; price: number | null; active: boolean }): FormData {
  const fd = new FormData();
  fd.set("name", fields.name);
  fd.set("kind", fields.kind);
  if (fields.price != null) fd.set("price", String(fields.price));
  fd.set("active", fields.active ? "true" : "false");
  return fd;
}

export function ProductsManager({ items }: { items: ProductServiceRow[] }) {
  const t = useTranslations("crm.products");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("PRODUCT");
  const [price, setPrice] = useState(0);
  const [filter, setFilter] = useState<Filter>("ALL");

  // The page loads the whole catalog, so the type filter runs here, with no round trip.
  const counts: Record<Filter, number> = {
    ALL: items.length,
    PRODUCT: items.filter((i) => i.kind === "PRODUCT").length,
    SERVICE: items.filter((i) => i.kind === "SERVICE").length,
  };
  const visible = filter === "ALL" ? items : items.filter((i) => i.kind === filter);
  const filters: { value: Filter; label: string }[] = [
    { value: "ALL", label: t("filterAll") },
    { value: "PRODUCT", label: t("filterProducts") },
    { value: "SERVICE", label: t("filterServices") },
  ];

  function run(fn: () => Promise<Result>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(t(`error.${r.error ?? "unknown"}`));
      else router.refresh();
    });
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    setPrice(0);
    run(() => createProductService(buildForm({ name: trimmed, kind, price: price || null, active: true })));
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The title keeps this form's "Tipo" from passing for the list's filter. */}
      <form
        onSubmit={onCreate}
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
      >
        <p className="text-sm font-semibold text-brand">{t("addTitle")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("name")}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("kind")}</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="PRODUCT">{t("kindProduct")}</option>
              <option value="SERVICE">{t("kindService")}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("price")}</label>
            <MoneyInput defaultValue={0} onValueChange={setPrice} className="h-10 w-40" />
          </div>
          <Button type="submit" disabled={pending}>
            <Plus className="size-4" />
            {t("add")}
          </Button>
        </div>
      </form>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span id="productsKindFilter" className="text-xs font-medium text-muted-foreground">
                {t("filterLabel")}
              </span>
              <div role="group" aria-labelledby="productsKindFilter" className="inline-flex gap-1 rounded-lg bg-muted p-1">
                {filters.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    aria-pressed={filter === f.value}
                    onClick={() => setFilter(f.value)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      filter === f.value ? "bg-card text-brand shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f.label}
                    <span
                      className={cn(
                        "min-w-5 rounded-full px-1.5 text-center text-xs font-semibold",
                        filter === f.value ? "bg-brand text-brand-foreground" : "bg-border text-foreground/70",
                      )}
                    >
                      {counts[f.value]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <span className="text-xs text-muted-foreground">
              {filter === "ALL"
                ? t("totalItems", { count: items.length })
                : t("shownOf", { shown: visible.length, total: items.length })}
            </span>
          </div>

          {visible.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              {filter === "PRODUCT" ? t("emptyProducts") : t("emptyServices")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("name")}</th>
                    <th className="px-4 py-3 font-medium">{t("kind")}</th>
                    <th className="px-4 py-3 font-medium">{t("price")}</th>
                    <th className="px-4 py-3 font-medium">{t("status")}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <ItemRow key={item.id} item={item} pending={pending} run={run} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  pending,
  run,
}: {
  item: ProductServiceRow;
  pending: boolean;
  run: (fn: () => Promise<Result>) => void;
}) {
  const t = useTranslations("crm.products");
  const confirm = useConfirm();
  const [name, setName] = useState(item.name);
  const [kind, setKind] = useState<Kind>(item.kind);
  const [price, setPrice] = useState<number | null>(item.price);
  const [active, setActive] = useState(item.active);

  const dirty =
    name.trim() !== item.name || kind !== item.kind || (price ?? null) !== item.price || active !== item.active;

  function onSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    run(() => updateProductService(item.id, buildForm({ name: trimmed, kind, price, active })));
  }

  async function onToggleActive() {
    const next = !active;
    setActive(next);
    run(() => updateProductService(item.id, buildForm({ name: item.name, kind: item.kind, price: item.price, active: next })));
  }

  async function onDelete() {
    if (!(await confirm({ description: t("deleteConfirm", { name: item.name }), confirmLabel: t("delete"), variant: "danger" })))
      return;
    run(() => deleteProductService(item.id));
  }

  return (
    <tr className={cn("border-b border-border last:border-0", !active && "opacity-60")}>
      <td className="px-4 py-3">
        {/* min-w: in a narrow window the table scrolls instead of squeezing names to one letter. */}
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 min-w-60" />
      </td>
      <td className="px-4 py-3">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="PRODUCT">{t("kindProduct")}</option>
          <option value="SERVICE">{t("kindService")}</option>
        </select>
      </td>
      <td className="px-4 py-3">
        <MoneyInput
          key={item.id}
          defaultValue={price ?? 0}
          onValueChange={(n) => setPrice(n || null)}
          className="h-9 w-36"
        />
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          disabled={pending}
          onClick={onToggleActive}
          className={cn(
            "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50",
            active ? "bg-green-500/10 text-green-600 hover:bg-green-500/20" : "bg-muted text-muted-foreground hover:bg-muted/70",
          )}
        >
          {active ? t("active") : t("inactive")}
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || !dirty}
            onClick={onSave}
          >
            <Save className="size-4" />
            {pending ? t("saving") : t("save")}
          </Button>
          <button
            type="button"
            disabled={pending}
            onClick={onDelete}
            aria-label={t("delete")}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
