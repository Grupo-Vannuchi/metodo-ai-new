"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, Check, Undo2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { formatBRL } from "@/lib/money";
import { deleteEntry, settleEntry } from "@/app/actions/finance";
import type { EntryRow } from "@/lib/queries/finance";

type TypeTab = "ALL" | "INCOME" | "EXPENSE";
type StatusTab = "ALL" | "PENDING" | "SETTLED";

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function EntriesTable({ rows }: { rows: EntryRow[] }) {
  const t = useTranslations("finance");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [typeTab, setTypeTab] = useState<TypeTab>("ALL");
  const [statusTab, setStatusTab] = useState<StatusTab>("ALL");

  const filtered = rows.filter(
    (r) => (typeTab === "ALL" || r.type === typeTab) && (statusTab === "ALL" || r.status === statusTab),
  );

  function onSettle(r: EntryRow) {
    start(async () => {
      await settleEntry(r.id, r.status !== "SETTLED");
      router.refresh();
    });
  }

  async function onDelete(r: EntryRow) {
    if (!(await confirm({ description: t("deleteConfirm", { d: r.description }), confirmLabel: t("delete"), variant: "danger" })))
      return;
    start(async () => {
      await deleteEntry(r.id);
      router.refresh();
    });
  }

  const tab = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-1.5 text-sm transition-colors",
      active ? "bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:bg-muted",
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={tab(typeTab === "ALL")} onClick={() => setTypeTab("ALL")}>{t("filter.all")}</button>
          <button type="button" className={tab(typeTab === "INCOME")} onClick={() => setTypeTab("INCOME")}>{t("nav.income")}</button>
          <button type="button" className={tab(typeTab === "EXPENSE")} onClick={() => setTypeTab("EXPENSE")}>{t("nav.expense")}</button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" className={tab(statusTab === "ALL")} onClick={() => setStatusTab("ALL")}>{t("filter.allStatus")}</button>
          <button type="button" className={tab(statusTab === "PENDING")} onClick={() => setStatusTab("PENDING")}>{t("filter.pending")}</button>
          <button type="button" className={tab(statusTab === "SETTLED")} onClick={() => setStatusTab("SETTLED")}>{t("filter.settled")}</button>
        </div>
        <Link href="/app/finance/entries/new" className={buttonVariants({ size: "sm" })}>
          <Plus className="size-4" />
          {t("newEntry")}
        </Link>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t("col.dueDate")}</th>
                <th className="px-4 py-3 font-medium">{t("col.description")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("col.amount")}</th>
                <th className="px-4 py-3 font-medium">{t("col.status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const income = r.type === "INCOME";
                const sub = [r.categoryName, r.contactName ?? r.companyName].filter(Boolean).join(" · ");
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDate(r.dueDate)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.description}</p>
                      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
                    </td>
                    <td className={cn("whitespace-nowrap px-4 py-3 text-right font-semibold", income ? "text-green-600" : "text-red-600")}>
                      {income ? "+" : "−"} {formatBRL(r.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs",
                          r.status === "SETTLED"
                            ? "bg-green-500/10 text-green-600"
                            : "bg-amber-500/10 text-amber-600",
                        )}
                      >
                        {t(`status.${r.status}.${r.type}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => onSettle(r)}
                          title={r.status === "SETTLED" ? t("reopen") : t("settle")}
                          aria-label={r.status === "SETTLED" ? t("reopen") : t("settle")}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          {r.status === "SETTLED" ? <Undo2 className="size-4" /> : <Check className="size-4" />}
                        </button>
                        <Link
                          href={`/app/finance/entries/${r.id}`}
                          aria-label={t("edit")}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="size-4" />
                        </Link>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => onDelete(r)}
                          aria-label={t("delete")}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
