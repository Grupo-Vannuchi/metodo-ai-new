"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { createPayrollRun } from "@/app/actions/payroll";

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Open a payroll for a month. Payslips are seeded from the active employees'
 * base salary; the user then adjusts each one. */
export function PayrollRunForm({
  categories,
}: {
  categories: { id: string; name: string }[];
}) {
  const t = useTranslations("hr");
  const router = useRouter();
  const now = new Date();

  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  // Default pay date: the 5th of the following month (a common Brazilian date).
  const [payDate, setPayDate] = useState(
    new Date(now.getFullYear(), now.getMonth() + 1, 5).toISOString().slice(0, 10),
  );
  const [categoryId, setCategoryId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const r = await createPayrollRun({
      year: Number(year),
      month: Number(month),
      payDate,
      categoryId,
      notes,
    });
    setSaving(false);
    if (r.ok) {
      router.push(`/app/hr/payroll/${r.id}`);
      router.refresh();
    } else {
      setError(t(`payroll.error.${r.error}`));
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("payroll.form.section")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="month">{t("payroll.form.month")}</Label>
            <select id="month" className={selectCls} value={month} onChange={(e) => setMonth(e.target.value)}>
              {MONTHS.map((m) => (
                <option key={m} value={m}>{t(`payroll.month.${m}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="year">{t("payroll.form.year")}</Label>
            <Input
              id="year"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="payDate">{t("payroll.form.payDate")}</Label>
            <Input id="payDate" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">{t("payroll.form.payDateHint")}</p>
          </div>
          <div>
            <Label htmlFor="categoryId">{t("payroll.form.category")}</Label>
            <select
              id="categoryId"
              className={selectCls}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{t("payroll.form.noCategory")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">{t("payroll.form.categoryHint")}</p>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Label htmlFor="notes">{t("payroll.form.notes")}</Label>
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <p className="mt-4 rounded-lg border border-brand/30 bg-brand/5 p-3 text-xs text-muted-foreground">
          {t("payroll.form.seedHint")}
        </p>
      </fieldset>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? t("payroll.form.creating") : t("payroll.form.create")}
        </Button>
        <Link
          href="/app/hr/payroll"
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("form.cancel")}
        </Link>
      </div>
    </form>
  );
}
