"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { requestTimeOff } from "@/app/actions/time-off";
import { TIME_OFF_TYPES, daysBetween, type TimeOffTypeKey } from "@/lib/validations/time-off";

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

/** Request time off for an employee (goes in as PENDING, managers decide). */
export function TimeOffForm({
  employees,
}: {
  employees: { id: string; name: string }[];
}) {
  const t = useTranslations("hr");
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState<TimeOffTypeKey>("VACATION");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = employeeId && startDate && endDate && new Date(endDate) >= new Date(startDate);
  const days = valid ? daysBetween(new Date(startDate), new Date(endDate)) : 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!valid) {
      setError(t("timeOff.error.invalid"));
      return;
    }
    setSaving(true);
    const r = await requestTimeOff({ employeeId, type, startDate, endDate, reason });
    setSaving(false);
    if (r.ok) {
      router.push("/app/hr/timeoff");
      router.refresh();
    } else {
      setError(t(`timeOff.error.${r.error}`));
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("timeOff.form.section")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="employeeId">{t("timeOff.form.employee")}</Label>
            <select
              id="employeeId"
              className={selectCls}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">{t("timeOff.form.pickEmployee")}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="type">{t("timeOff.form.type")}</Label>
            <select
              id="type"
              className={selectCls}
              value={type}
              onChange={(e) => setType(e.target.value as TimeOffTypeKey)}
            >
              {TIME_OFF_TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(`timeOff.type.${ty}`)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <p className="text-sm text-muted-foreground">
              {days > 0 ? t("timeOff.dayCount", { count: days }) : ""}
            </p>
          </div>
          <div>
            <Label htmlFor="startDate">{t("timeOff.form.start")}</Label>
            <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="endDate">{t("timeOff.form.end")}</Label>
            <Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="reason">{t("timeOff.form.reason")}</Label>
            <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
      </fieldset>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={saving || !valid}>
          {saving ? t("timeOff.form.sending") : t("timeOff.form.submit")}
        </Button>
        <Link
          href="/app/hr/timeoff"
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("form.cancel")}
        </Link>
      </div>
    </form>
  );
}
