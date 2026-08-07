"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Search, Package, ArrowLeftRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { ItemForm } from "@/components/supplies/item-form";
import { emptyItemForm } from "@/lib/supplies/item-form-values";
import type { SupplyItemRow } from "@/lib/queries/supply-items";

type Supplier = { id: string; name: string };

export function ItemsList({
  items,
  suppliers,
  categories,
  units,
  warehouses,
}: {
  items: SupplyItemRow[];
  suppliers: Supplier[];
  categories: string[];
  units: string[];
  warehouses: string[];
}) {
  const t = useTranslations("supplies.items");
  const tm = useTranslations("supplies.stock");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const term = q.trim().toLowerCase();
  const filtered = term
    ? items.filter((i) =>
        [i.description, i.code, i.supplierName, i.category, i.unit].some((x) => (x ?? "").toLowerCase().includes(term)),
      )
    : items;
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-sm focus-visible:border-brand focus-visible:outline-none"
          />
        </div>
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          {t("new")}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {items.length === 0 ? t("empty") : t("noResults")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((i) => (
            <li key={i.id} className="flex items-stretch gap-1.5">
              <Link
                href={`/app/supplies/items/${i.id}/edit`}
                className={cn(
                  "hover-lift flex flex-1 items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-brand/40",
                  !i.active && "opacity-60",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Package className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{i.description}</span>
                    {i.code ? <span className="text-xs text-muted-foreground">{i.code}</span> : null}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {t(`typeOpt.${i.type}`)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    {i.category ? <span>{i.category}</span> : null}
                    {i.unit ? <span>{i.unit}</span> : null}
                    {i.supplierName ? <span>{i.supplierName}</span> : null}
                  </span>
                </span>
                {i.salePrice != null ? (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-brand">{brl.format(i.salePrice)}</span>
                ) : null}
              </Link>
              <Link
                href={{ pathname: "/app/supplies/stock", query: { move: i.id } }}
                title={tm("moveItem")}
                aria-label={tm("moveItem")}
                className="flex shrink-0 items-center justify-center rounded-lg border border-border bg-card px-3 text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand"
              >
                <ArrowLeftRight className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Drawer open={creating} onClose={() => setCreating(false)} title={t("newTitle")} className="max-w-2xl">
        {creating ? (
          <ItemForm
            defaults={emptyItemForm()}
            suppliers={suppliers}
            categories={categories}
            units={units}
            warehouses={warehouses}
            onDone={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        ) : null}
      </Drawer>
    </div>
  );
}
