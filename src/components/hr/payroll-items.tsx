"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  FileText,
  FileType,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Input } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { updatePayrollItemLines } from "@/app/actions/payroll";
import { PAYROLL_LINE_TYPES, type PayrollLineTypeKey } from "@/lib/validations/payroll";
import type { PayrollItemRow } from "@/lib/queries/payroll";

type LineRow = { key: string; rev: number; type: PayrollLineTypeKey; label: string; amount: number };

const selectCls = cn(
  "h-10 rounded-lg border border-border bg-card px-2 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

/** One payslip: totals row that expands into its line editor. */
function ItemEditor({
  item,
  editable,
}: {
  item: PayrollItemRow;
  editable: boolean;
}) {
  const t = useTranslations("hr");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(item.lines.length);

  const [lines, setLines] = useState<LineRow[]>(() =>
    item.lines.map((l, i) => ({ key: `l-${i}`, rev: 0, type: l.type, label: l.label, amount: l.amount })),
  );

  const earnings = lines.filter((l) => l.type === "EARNING").reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const deductions = lines.filter((l) => l.type === "DEDUCTION").reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const net = Math.max(0, earnings - deductions);

  function patch(key: string, p: Partial<LineRow>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }
  function addLine(type: PayrollLineTypeKey) {
    setLines((prev) => [...prev, { key: `n-${seq}`, rev: 0, type, label: "", amount: 0 }]);
    setSeq((s) => s + 1);
  }
  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function save() {
    setError(null);
    setSaving(true);
    const r = await updatePayrollItemLines(
      item.id,
      lines
        .filter((l) => l.label.trim())
        .map((l) => ({ type: l.type, label: l.label.trim(), amount: Number(l.amount) || 0 })),
    );
    setSaving(false);
    if (r.ok) router.refresh();
    else setError(t(`payroll.error.${r.error}`));
  }

  const payslipBase = `/api/hr/payroll/items/${item.id}/payslip`;

  return (
    <>
      <tr className="border-b border-border last:border-0 hover:bg-muted/30">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 text-left"
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.employeeName}</span>
              {item.jobRoleName ? (
                <span className="block truncate text-xs text-muted-foreground">{item.jobRoleName}</span>
              ) : null}
            </span>
          </button>
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
          {formatBRL(item.totalEarnings)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
          − {formatBRL(item.totalDeductions)}
        </td>
        <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand">
          {formatBRL(item.netPay)}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1">
            <a
              href={`${payslipBase}?format=pdf`}
              target="_blank"
              rel="noopener noreferrer"
              title={t("payroll.payslipPdf")}
              aria-label={t("payroll.payslipPdf")}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <FileText className="size-4" />
            </a>
            <a
              href={`${payslipBase}?format=word`}
              title={t("payroll.payslipWord")}
              aria-label={t("payroll.payslipWord")}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <FileType className="size-4" />
            </a>
            {item.financeEntryId ? (
              <span
                title={t("payroll.postedToFinance")}
                className="rounded-md p-2 text-green-600"
              >
                <Wallet className="size-4" />
              </span>
            ) : null}
          </div>
        </td>
      </tr>

      {open ? (
        <tr className="border-b border-border bg-muted/20 last:border-0">
          <td colSpan={5} className="px-4 py-4">
            <div className="flex flex-col gap-2">
              {lines.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                  {t("payroll.noLines")}
                </p>
              ) : (
                lines.map((l) => (
                  <div key={l.key} className="flex flex-wrap items-center gap-2">
                    <select
                      value={l.type}
                      disabled={!editable}
                      onChange={(e) => patch(l.key, { type: e.target.value as PayrollLineTypeKey })}
                      className={cn(selectCls, "w-32 shrink-0 disabled:opacity-60")}
                      aria-label={t("payroll.lineType")}
                    >
                      {PAYROLL_LINE_TYPES.map((ty) => (
                        <option key={ty} value={ty}>{t(`payroll.lineTypeLabel.${ty}`)}</option>
                      ))}
                    </select>
                    <Input
                      value={l.label}
                      disabled={!editable}
                      onChange={(e) => patch(l.key, { label: e.target.value })}
                      placeholder={t("payroll.lineLabel")}
                      className="h-10 min-w-40 flex-1 disabled:opacity-60"
                    />
                    <div className="w-36 shrink-0">
                      <MoneyInput
                        key={`${l.key}:${l.rev}`}
                        defaultValue={l.amount}
                        disabled={!editable}
                        onValueChange={(n) => patch(l.key, { amount: n })}
                      />
                    </div>
                    {editable ? (
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        aria-label={t("payroll.removeLine")}
                        className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : null}
                  </div>
                ))
              )}

              {editable ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => addLine("EARNING")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="size-3.5" />
                    {t("payroll.addEarning")}
                  </button>
                  <button
                    type="button"
                    onClick={() => addLine("DEDUCTION")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="size-3.5" />
                    {t("payroll.addDeduction")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? <Spinner className="size-3.5" /> : null}
                    {t("payroll.saveLines")}
                  </button>
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap justify-end gap-4 border-t border-border pt-2 text-sm">
                <span className="text-muted-foreground">
                  {t("payroll.earnings")}: <span className="tabular-nums">{formatBRL(earnings)}</span>
                </span>
                <span className="text-muted-foreground">
                  {t("payroll.deductions")}: <span className="tabular-nums">− {formatBRL(deductions)}</span>
                </span>
                <span className="font-semibold text-brand">
                  {t("payroll.net")}: <span className="tabular-nums">{formatBRL(net)}</span>
                </span>
              </div>

              {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The payslip table of a payroll run. Lines are editable while it is a DRAFT. */
export function PayrollItems({
  items,
  editable,
}: {
  items: PayrollItemRow[];
  editable: boolean;
}) {
  const t = useTranslations("hr");

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{t("payroll.colEmployee")}</th>
            <th className="px-4 py-3 text-right font-medium">{t("payroll.earnings")}</th>
            <th className="px-4 py-3 text-right font-medium">{t("payroll.deductions")}</th>
            <th className="px-4 py-3 text-right font-medium">{t("payroll.net")}</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ItemEditor key={item.id} item={item} editable={editable} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
