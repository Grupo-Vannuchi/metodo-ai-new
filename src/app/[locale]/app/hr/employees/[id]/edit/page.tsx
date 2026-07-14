import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { employeeFormOptions, getEmployee } from "@/lib/queries/hr";
import { EmployeeForm, type EmployeeFormDefaults } from "@/components/hr/employee-form";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/** Date → yyyy-mm-dd for the native date inputs. */
const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("hr");

  const [options, employee] = await Promise.all([
    employeeFormOptions(ctx.organizationId),
    getEmployee(ctx.organizationId, id),
  ]);
  if (!employee) notFound();

  const defaults: EmployeeFormDefaults = {
    name: employee.name,
    email: employee.email ?? "",
    phone: employee.phone ?? "",
    documentType: employee.documentType ?? "",
    document: employee.document ?? "",
    birthDate: iso(employee.birthDate),
    userId: employee.userId ?? "",
    addressZip: employee.addressZip ?? "",
    addressStreet: employee.addressStreet ?? "",
    addressNumber: employee.addressNumber ?? "",
    addressCity: employee.addressCity ?? "",
    addressState: employee.addressState ?? "",
    jobRoleId: employee.jobRoleId ?? "",
    departmentId: employee.departmentId ?? "",
    contractType: employee.contractType,
    status: employee.status,
    hiredAt: iso(employee.hiredAt),
    probationEndsAt: iso(employee.probationEndsAt),
    terminatedAt: iso(employee.terminatedAt),
    terminationReason: employee.terminationReason ?? "",
    weeklyHours: employee.weeklyHours != null ? String(employee.weeklyHours) : "",
    bankName: employee.bankName ?? "",
    bankBranch: employee.bankBranch ?? "",
    bankAccount: employee.bankAccount ?? "",
    pixKey: employee.pixKey ?? "",
    notes: employee.notes ?? "",
    baseSalary: employee.baseSalary,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("form.editTitle")}</h1>
        <Link href={`/app/hr/employees/${id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("back")}
        </Link>
      </div>
      <EmployeeForm id={id} defaults={defaults} options={options} />
    </div>
  );
}
