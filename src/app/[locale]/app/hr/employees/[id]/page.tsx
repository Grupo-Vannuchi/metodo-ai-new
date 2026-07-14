import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Pencil, UserCheck } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getEmployee, listEmployeeDocuments } from "@/lib/queries/hr";
import { EmployeeDocuments } from "@/components/hr/employee-documents";
import { DeleteEmployeeButton } from "@/components/hr/delete-employee-button";
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

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("hr");

  const [employee, documents] = await Promise.all([
    getEmployee(ctx.organizationId, id),
    listEmployeeDocuments(ctx.organizationId, id),
  ]);
  if (!employee) notFound();

  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

  const personal: [string, string | null][] = [
    [t("form.email"), employee.email],
    [t("form.phone"), employee.phone],
    [employee.documentType ?? t("form.document"), employee.document],
    [t("form.birthDate"), employee.birthDate ? fmtDate(employee.birthDate) : null],
    [
      t("form.address"),
      [employee.addressStreet, employee.addressNumber, employee.addressCity, employee.addressState]
        .filter(Boolean)
        .join(", ") || null,
    ],
  ];

  const contract: [string, string | null][] = [
    [t("form.jobRole"), employee.jobRole?.name ?? null],
    [t("form.department"), employee.department?.name ?? null],
    [t("form.contractType"), t(`contract.${employee.contractType}`)],
    [t("form.hiredAt"), fmtDate(employee.hiredAt)],
    [t("form.probationEndsAt"), employee.probationEndsAt ? fmtDate(employee.probationEndsAt) : null],
    [t("form.weeklyHours"), employee.weeklyHours != null ? String(employee.weeklyHours) : null],
    ...(employee.status === "TERMINATED"
      ? ([
          [t("form.terminatedAt"), employee.terminatedAt ? fmtDate(employee.terminatedAt) : null],
          [t("form.terminationReason"), employee.terminationReason],
        ] as [string, string | null][])
      : []),
  ];

  const payment: [string, string | null][] = [
    [t("form.bankName"), employee.bankName],
    [t("form.bankBranch"), employee.bankBranch],
    [t("form.bankAccount"), employee.bankAccount],
    [t("form.pixKey"), employee.pixKey],
  ];

  const rows = (list: [string, string | null][]) =>
    list.filter(([, v]) => v).length === 0 ? (
      <span className="text-sm text-muted-foreground">—</span>
    ) : (
      list
        .filter(([, v]) => v)
        .map(([label, v]) => (
          <div key={label} className="flex gap-2 text-sm">
            <dt className="min-w-28 shrink-0 text-muted-foreground">{label}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{employee.name}</h1>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[employee.status])}>
              {t(`status.${employee.status}`)}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">
            {employee.jobRole?.name ?? t("form.none")}
            {employee.department ? ` · ${employee.department.name}` : ""}
          </p>
          {employee.userName ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-brand">
              <UserCheck className="size-3.5" />
              {t("linkedUser", { name: employee.userName })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/app/hr/employees/${employee.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Pencil className="size-4" />
            {t("edit")}
          </Link>
          <DeleteEmployeeButton id={employee.id} />
        </div>
      </div>

      <section className="rounded-xl border border-brand/30 bg-brand/5 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("form.baseSalary")}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-brand">{formatBRL(employee.baseSalary)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("salaryHint")}</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">{t("form.sectionPersonal")}</h2>
          <dl className="flex flex-col gap-1.5">{rows(personal)}</dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">{t("form.sectionContract")}</h2>
          <dl className="flex flex-col gap-1.5">{rows(contract)}</dl>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">{t("form.sectionPayment")}</h2>
        <dl className="flex flex-col gap-1.5">{rows(payment)}</dl>
      </section>

      {employee.notes ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold">{t("form.notes")}</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{employee.notes}</p>
        </section>
      ) : null}

      <EmployeeDocuments employeeId={employee.id} documents={documents} />

      <div>
        <Link href="/app/hr/employees" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {t("back")}
        </Link>
      </div>
    </div>
  );
}
