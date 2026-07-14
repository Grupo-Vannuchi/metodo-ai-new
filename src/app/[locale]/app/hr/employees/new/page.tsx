import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { employeeFormOptions } from "@/lib/queries/hr";
import { EmployeeForm, type EmployeeFormDefaults } from "@/components/hr/employee-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewEmployeePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("hr");

  const options = await employeeFormOptions(ctx.organizationId);

  const defaults: EmployeeFormDefaults = {
    name: "",
    email: "",
    phone: "",
    documentType: "",
    document: "",
    birthDate: "",
    userId: "",
    addressZip: "",
    addressStreet: "",
    addressNumber: "",
    addressCity: "",
    addressState: "",
    jobRoleId: "",
    departmentId: "",
    contractType: "CLT",
    status: "ACTIVE",
    hiredAt: new Date().toISOString().slice(0, 10),
    probationEndsAt: "",
    terminatedAt: "",
    terminationReason: "",
    weeklyHours: "",
    bankName: "",
    bankBranch: "",
    bankAccount: "",
    pixKey: "",
    notes: "",
    baseSalary: 0,
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("form.newTitle")}</h1>
      <EmployeeForm defaults={defaults} options={options} />
    </div>
  );
}
