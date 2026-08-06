"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Pencil, Check, Send, PackageCheck, Ban, Trash2, X } from "lucide-react";
import { useRouter, Link } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { setPurchaseOrderStatus, receivePurchaseOrder, deletePurchaseOrder } from "@/app/actions/purchases";
import { statusBadgeCls } from "@/components/supplies/purchase-status";
import type { PurchaseOrderDetail } from "@/lib/queries/purchases";

export function PurchaseDetail({ order }: { order: PurchaseOrderDetail }) {
  const t = useTranslations("supplies.purchases");
  const locale = useLocale();
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brl = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }), [locale]);
  const nf = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }), [locale]);
  const df = useMemo(() => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }), [locale]);

  const st = order.status;
  const canEdit = st === "DRAFT";
  const canApprove = st === "DRAFT";
  const canOrder = st === "APPROVED";
  const canReceive = st === "APPROVED" || st === "ORDERED" || st === "PARTIAL";
  const canCancel = st === "DRAFT" || st === "APPROVED" || st === "ORDERED" || st === "PARTIAL";
  const canDelete = st === "DRAFT" || st === "CANCELED";

  const pendingLines = order.items.filter((i) => i.quantity - i.receivedQty > 0.0001);
  const [recv, setRecv] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.items.map((i) => [i.id, String(Math.max(i.quantity - i.receivedQty, 0))])),
  );

  function transition(action: string) {
    setError(null);
    start(async () => {
      const res = await setPurchaseOrderStatus(order.id, action);
      if (res.ok) router.refresh();
      else setError(t("actionError"));
    });
  }

  async function onCancel() {
    if (!(await confirm({ description: t("cancelConfirm"), confirmLabel: t("cancelOrder"), variant: "danger" }))) return;
    transition("cancel");
  }

  async function onDelete() {
    if (!(await confirm({ description: t("deleteConfirm"), confirmLabel: t("delete"), variant: "danger" }))) return;
    setError(null);
    start(async () => {
      const res = await deletePurchaseOrder(order.id);
      if (res.ok) {
        router.push("/app/supplies/purchases");
        router.refresh();
      } else setError(t("actionError"));
    });
  }

  function submitReceive() {
    setError(null);
    const lines = order.items
      .map((i) => ({ lineId: i.id, qty: recv[i.id] ?? "0" }))
      .filter((l) => Number(l.qty) > 0);
    if (!lines.length) {
      setError(t("errNothingToReceive"));
      return;
    }
    start(async () => {
      const res = await receivePurchaseOrder(order.id, { lines });
      if (res.ok) {
        setReceiving(false);
        router.refresh();
      } else {
        setError(t("actionError"));
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{order.code ? `OC ${order.code}` : t("noCode")}</h1>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", statusBadgeCls[st])}>
              {t(`status.${st}`)}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.supplierName ?? t("noSupplier")}
            {order.warehouseName ? ` · ${order.warehouseName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <Link href={`/app/supplies/purchases/${order.id}/edit`} className={buttonVariants({ size: "sm", variant: "outline" })}>
              <Pencil className="size-4" />
              {t("edit")}
            </Link>
          ) : null}
          {canApprove ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => transition("approve")}>
              <Check className="size-4" />
              {t("approve")}
            </Button>
          ) : null}
          {canOrder ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => transition("order")}>
              <Send className="size-4" />
              {t("order")}
            </Button>
          ) : null}
          {canReceive ? (
            <Button size="sm" disabled={pending} onClick={() => setReceiving((v) => !v)}>
              <PackageCheck className="size-4" />
              {t("receive")}
            </Button>
          ) : null}
          {canCancel ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
              <Ban className="size-4" />
              {t("cancelOrder")}
            </Button>
          ) : null}
          {canDelete ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={onDelete}>
              <Trash2 className="size-4" />
              {t("delete")}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {/* Receiving panel */}
      {receiving && canReceive ? (
        <div className="flex flex-col gap-3 rounded-xl border border-brand/40 bg-brand/5 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("receiveTitle")}</h2>
            <button
              type="button"
              onClick={() => setReceiving(false)}
              className="rounded-lg p-1 text-muted-foreground hover:text-foreground"
              aria-label={t("cancel")}
            >
              <X className="size-4" />
            </button>
          </div>
          {pendingLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("allReceived")}</p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {pendingLines.map((i) => (
                  <li key={i.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm">{i.description}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("remaining")}: {nf.format(i.quantity - i.receivedQty)}
                    </span>
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      inputMode="decimal"
                      className="w-28 shrink-0"
                      value={recv[i.id] ?? ""}
                      onChange={(e) => setRecv((p) => ({ ...p, [i.id]: e.target.value }))}
                    />
                  </li>
                ))}
              </ul>
              <div>
                <Button size="sm" disabled={pending} onClick={submitReceive}>
                  {pending ? t("saving") : t("confirmReceive")}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Items */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t("description")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("qty")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("received")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("unitPrice")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((i) => {
              const full = i.receivedQty >= i.quantity - 0.0001;
              return (
                <tr key={i.id} className="border-t border-border">
                  <td className="px-3 py-2">{i.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{nf.format(i.quantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={cn(full ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                      {nf.format(i.receivedQty)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl.format(i.unitPrice)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{brl.format(i.total)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/30">
              <td className="px-3 py-2 font-medium" colSpan={4}>
                {t("total")}
              </td>
              <td className="px-3 py-2 text-right text-base font-semibold text-brand tabular-nums">{brl.format(order.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Meta */}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {order.expectedAt ? (
          <div className="flex justify-between border-b border-border/60 py-1">
            <dt className="text-muted-foreground">{t("expectedAt")}</dt>
            <dd>{df.format(order.expectedAt)}</dd>
          </div>
        ) : null}
        {order.receivedAt ? (
          <div className="flex justify-between border-b border-border/60 py-1">
            <dt className="text-muted-foreground">{t("receivedAt")}</dt>
            <dd>{df.format(order.receivedAt)}</dd>
          </div>
        ) : null}
        {order.notes ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">{t("notes")}</dt>
            <dd className="mt-1 whitespace-pre-wrap">{order.notes}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
