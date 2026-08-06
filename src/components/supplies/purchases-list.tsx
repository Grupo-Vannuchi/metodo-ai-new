"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, ShoppingCart } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PURCHASE_STATUSES, statusBadgeCls } from "@/components/supplies/purchase-status";
import type { PurchaseOrderRow } from "@/lib/queries/purchases";

export function PurchasesList({ orders }: { orders: PurchaseOrderRow[] }) {
  const t = useTranslations("supplies.purchases");
  const locale = useLocale();
  const [status, setStatus] = useState<string>("ALL");
  const brl = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }), [locale]);
  const df = useMemo(() => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "2-digit" }), [locale]);

  const tabs = ["ALL", ...PURCHASE_STATUSES];
  const filtered = status === "ALL" ? orders : orders.filter((o) => o.status === status);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {tabs.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                status === s ? "bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {s === "ALL" ? t("all") : t(`status.${s}`)}
            </button>
          ))}
        </div>
        <Link href="/app/supplies/purchases/new" className={buttonVariants({ size: "sm" })}>
          <Plus className="size-4" />
          {t("new")}
        </Link>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {orders.length === 0 ? t("empty") : t("noResults")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((o) => (
            <li key={o.id}>
              <Link
                href={`/app/supplies/purchases/${o.id}`}
                className="hover-lift flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-brand/40"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <ShoppingCart className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{o.code ? `OC ${o.code}` : t("noCode")}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusBadgeCls[o.status])}>
                      {t(`status.${o.status}`)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span>{o.supplierName ?? t("noSupplier")}</span>
                    <span>{t("itemCount", { count: o.itemCount })}</span>
                    {o.expectedAt ? <span>{t("expected", { date: df.format(o.expectedAt) })}</span> : null}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-brand">{brl.format(o.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
