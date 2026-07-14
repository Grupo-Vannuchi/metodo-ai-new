"use client";

import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { EMPLOYEE_STATUS_FILTERS, type EmployeeStatusFilter } from "@/lib/validations/employee";

const selectClass = cn(
  "h-9 rounded-lg border border-border bg-card px-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

/** Status + department filters and search for the employees list. Each control
 * navigates preserving the others (same pattern as the proposals toolbar). */
export function EmployeesToolbar({
  status,
  departmentId,
  q,
  departments,
}: {
  status: EmployeeStatusFilter;
  departmentId: string;
  q: string;
  departments: { id: string; name: string }[];
}) {
  const t = useTranslations("hr");
  const router = useRouter();

  function push(next: { status?: EmployeeStatusFilter; departmentId?: string; q?: string }) {
    const s = next.status ?? status;
    const d = next.departmentId ?? departmentId;
    const term = next.q ?? q;
    const params = new URLSearchParams();
    if (s !== "ALL") params.set("status", s);
    if (d) params.set("department", d);
    if (term.trim()) params.set("q", term.trim());
    const qs = params.toString();
    router.push(qs ? `/app/hr/employees?${qs}` : "/app/hr/employees");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get("q");
          push({ q: typeof value === "string" ? value : "" });
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          name="q"
          defaultValue={q}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="h-9 w-56 rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm focus-visible:border-brand focus-visible:outline-none"
        />
      </form>

      <select
        aria-label={t("filterStatus")}
        value={status}
        onChange={(e) => push({ status: e.target.value as EmployeeStatusFilter })}
        className={selectClass}
      >
        {EMPLOYEE_STATUS_FILTERS.map((s) => (
          <option key={s} value={s}>
            {s === "ALL" ? t("filterAll") : t(`status.${s}`)}
          </option>
        ))}
      </select>

      <select
        aria-label={t("filterDepartment")}
        value={departmentId}
        onChange={(e) => push({ departmentId: e.target.value })}
        className={selectClass}
      >
        <option value="">{t("allDepartments")}</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
    </div>
  );
}
