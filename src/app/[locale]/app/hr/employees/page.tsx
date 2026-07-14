import { getTranslations } from "next-intl/server";
import { Plus, UserCheck } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listEmployees, listDepartments } from "@/lib/queries/hr";
import { EMPLOYEE_STATUS_FILTERS, type EmployeeStatusFilter } from "@/lib/validations/employee";
import { EmployeesToolbar } from "@/components/hr/employees-toolbar";
import { OpenRow } from "@/components/ui/open-row";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-green-500/10 text-green-600",
  ON_LEAVE: "bg-amber-500/10 text-amber-600",
  TERMINATED: "bg-muted text-muted-foreground",
};

export default async function EmployeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; department?: string; q?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("hr");

  const sp = await searchParams;
  const status = (
    EMPLOYEE_STATUS_FILTERS.includes(sp?.status as EmployeeStatusFilter) ? sp!.status : "ALL"
  ) as EmployeeStatusFilter;
  const departmentId = sp?.department ?? "";
  const q = sp?.q ?? "";

  const [employees, departments] = await Promise.all([
    listEmployees(ctx.organizationId, { status, departmentId: departmentId || undefined, q }),
    listDepartments(ctx.organizationId),
  ]);

  const fmtDate = (d: Date) => new Date(d).toLocaleDateString("pt-BR");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EmployeesToolbar
          status={status}
          departmentId={departmentId}
          q={q}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        />
        <Link href="/app/hr/employees/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("newEmployee")}
        </Link>
      </div>

      {employees.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("emptyEmployees")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("colName")}</th>
                <th className="px-5 py-3 font-medium">{t("colRole")}</th>
                <th className="px-5 py-3 font-medium">{t("colContract")}</th>
                <th className="px-5 py-3 font-medium">{t("colStatus")}</th>
                <th className="px-5 py-3 font-medium">{t("colHiredAt")}</th>
                <th className="px-5 py-3 text-right font-medium">{t("colSalary")}</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <OpenRow
                  key={e.id}
                  href={`/app/hr/employees/${e.id}`}
                  title={t("openHint")}
                  className="border-b border-border align-top last:border-0 hover:bg-muted/40"
                >
                  <td className="px-5 py-3">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1.5 font-medium">
                        {e.name}
                        {e.hasUser ? (
                          <UserCheck className="size-3.5 shrink-0 text-brand" aria-label={t("hasUser")} />
                        ) : null}
                      </span>
                      {e.email ? <span className="text-xs text-muted-foreground">{e.email}</span> : null}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-col">
                      <span>{e.jobRoleName ?? "—"}</span>
                      {e.departmentName ? (
                        <span className="text-xs text-muted-foreground">{e.departmentName}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{t(`contract.${e.contractType}`)}</td>
                  <td className="px-5 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[e.status])}>
                      {t(`status.${e.status}`)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{fmtDate(e.hiredAt)}</td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-brand">
                    {formatBRL(e.baseSalary)}
                  </td>
                </OpenRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
