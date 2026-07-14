"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { createEmployee, updateEmployee } from "@/app/actions/hr";
import {
  EMPLOYEE_STATUSES,
  CONTRACT_TYPES,
  type EmployeeStatusKey,
  type ContractTypeKey,
} from "@/lib/validations/employee";
import type { EmployeeFormOptions } from "@/lib/queries/hr";

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

type Fields = {
  name: string;
  email: string;
  phone: string;
  documentType: "" | "CPF" | "CNPJ";
  document: string;
  birthDate: string;
  userId: string;
  addressZip: string;
  addressStreet: string;
  addressNumber: string;
  addressCity: string;
  addressState: string;
  jobRoleId: string;
  departmentId: string;
  contractType: ContractTypeKey;
  status: EmployeeStatusKey;
  hiredAt: string;
  probationEndsAt: string;
  terminatedAt: string;
  terminationReason: string;
  weeklyHours: string;
  bankName: string;
  bankBranch: string;
  bankAccount: string;
  pixKey: string;
  notes: string;
};

export type EmployeeFormDefaults = Fields & { baseSalary: number };

export function EmployeeForm({
  id,
  defaults,
  options,
}: {
  id?: string; // present = edit mode
  defaults: EmployeeFormDefaults;
  options: EmployeeFormOptions;
}) {
  const t = useTranslations("hr");
  const tv = useTranslations("validation");
  const router = useRouter();
  const isEdit = Boolean(id);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Fields>({ defaultValues: defaults });

  const [serverError, setServerError] = useState<string | null>(null);
  const [baseSalary, setBaseSalary] = useState(defaults.baseSalary);

  // Termination fields only make sense once the employee is marked TERMINATED.
  // Mirrored in local state (instead of RHF's `watch`, which opts the component
  // out of the React Compiler) — the select drives both.
  const [status, setStatus] = useState<EmployeeStatusKey>(defaults.status);
  const statusField = register("status");

  async function onSubmit(values: Fields) {
    setServerError(null);
    const payload = {
      ...values,
      baseSalary,
      weeklyHours: values.weeklyHours.trim() ? Number(values.weeklyHours) : null,
    };
    const result = isEdit ? await updateEmployee(id!, payload) : await createEmployee(payload);

    if (result.ok) {
      router.push(`/app/hr/employees/${result.id}`);
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      {/* Personal */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionPersonal")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <Label htmlFor="name">{t("form.name")}</Label>
            <Input id="name" aria-invalid={Boolean(errors.name)} {...register("name", { required: tv("required") })} />
            {errors.name ? <p className="mt-1 text-sm text-red-500">{errors.name.message}</p> : null}
          </div>
          <div>
            <Label htmlFor="email">{t("form.email")}</Label>
            <Input id="email" type="email" {...register("email")} />
          </div>
          <div>
            <Label htmlFor="phone">{t("form.phone")}</Label>
            <Input id="phone" {...register("phone")} />
          </div>
          <div>
            <Label htmlFor="documentType">{t("form.documentType")}</Label>
            <select id="documentType" className={selectCls} {...register("documentType")}>
              <option value="">{t("form.none")}</option>
              <option value="CPF">CPF</option>
              <option value="CNPJ">CNPJ</option>
            </select>
          </div>
          <div>
            <Label htmlFor="document">{t("form.document")}</Label>
            <Input id="document" {...register("document")} />
          </div>
          <div>
            <Label htmlFor="birthDate">{t("form.birthDate")}</Label>
            <Input id="birthDate" type="date" {...register("birthDate")} />
          </div>
          <div>
            <Label htmlFor="userId">{t("form.systemUser")}</Label>
            <select id="userId" className={selectCls} {...register("userId")}>
              <option value="">{t("form.noSystemUser")}</option>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">{t("form.systemUserHint")}</p>
          </div>
        </div>
      </fieldset>

      {/* Address */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionAddress")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <Label htmlFor="addressZip">{t("form.zip")}</Label>
            <Input id="addressZip" {...register("addressZip")} />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="addressStreet">{t("form.street")}</Label>
            <Input id="addressStreet" {...register("addressStreet")} />
          </div>
          <div className="sm:col-span-1">
            <Label htmlFor="addressNumber">{t("form.number")}</Label>
            <Input id="addressNumber" {...register("addressNumber")} />
          </div>
          <div className="sm:col-span-4">
            <Label htmlFor="addressCity">{t("form.city")}</Label>
            <Input id="addressCity" {...register("addressCity")} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="addressState">{t("form.state")}</Label>
            <Input id="addressState" maxLength={2} {...register("addressState")} />
          </div>
        </div>
      </fieldset>

      {/* Contract */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionContract")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="jobRoleId">{t("form.jobRole")}</Label>
            <select id="jobRoleId" className={selectCls} {...register("jobRoleId")}>
              <option value="">{t("form.none")}</option>
              {options.jobRoles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="departmentId">{t("form.department")}</Label>
            <select id="departmentId" className={selectCls} {...register("departmentId")}>
              <option value="">{t("form.none")}</option>
              {options.departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="contractType">{t("form.contractType")}</Label>
            <select id="contractType" className={selectCls} {...register("contractType")}>
              {CONTRACT_TYPES.map((c) => (
                <option key={c} value={c}>{t(`contract.${c}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="status">{t("form.status")}</Label>
            <select
              id="status"
              className={selectCls}
              {...statusField}
              onChange={(e) => {
                void statusField.onChange(e);
                setStatus(e.target.value as EmployeeStatusKey);
              }}
            >
              {EMPLOYEE_STATUSES.map((s) => (
                <option key={s} value={s}>{t(`status.${s}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="hiredAt">{t("form.hiredAt")}</Label>
            <Input
              id="hiredAt"
              type="date"
              aria-invalid={Boolean(errors.hiredAt)}
              {...register("hiredAt", { required: tv("required") })}
            />
            {errors.hiredAt ? <p className="mt-1 text-sm text-red-500">{errors.hiredAt.message}</p> : null}
          </div>
          <div>
            <Label htmlFor="probationEndsAt">{t("form.probationEndsAt")}</Label>
            <Input id="probationEndsAt" type="date" {...register("probationEndsAt")} />
            <p className="mt-1 text-xs text-muted-foreground">{t("form.probationHint")}</p>
          </div>
          <div>
            <Label htmlFor="baseSalary">{t("form.baseSalary")}</Label>
            <MoneyInput defaultValue={defaults.baseSalary} onValueChange={setBaseSalary} />
            <p className="mt-1 text-xs text-muted-foreground">{t("form.baseSalaryHint")}</p>
          </div>
          <div>
            <Label htmlFor="weeklyHours">{t("form.weeklyHours")}</Label>
            <Input id="weeklyHours" type="number" min={0} max={80} {...register("weeklyHours")} />
          </div>

          {status === "TERMINATED" ? (
            <>
              <div>
                <Label htmlFor="terminatedAt">{t("form.terminatedAt")}</Label>
                <Input id="terminatedAt" type="date" {...register("terminatedAt")} />
              </div>
              <div>
                <Label htmlFor="terminationReason">{t("form.terminationReason")}</Label>
                <Input id="terminationReason" {...register("terminationReason")} />
              </div>
            </>
          ) : null}
        </div>
      </fieldset>

      {/* Payment */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionPayment")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="bankName">{t("form.bankName")}</Label>
            <Input id="bankName" {...register("bankName")} />
          </div>
          <div>
            <Label htmlFor="pixKey">{t("form.pixKey")}</Label>
            <Input id="pixKey" {...register("pixKey")} />
          </div>
          <div>
            <Label htmlFor="bankBranch">{t("form.bankBranch")}</Label>
            <Input id="bankBranch" {...register("bankBranch")} />
          </div>
          <div>
            <Label htmlFor="bankAccount">{t("form.bankAccount")}</Label>
            <Input id="bankAccount" {...register("bankAccount")} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Label htmlFor="notes">{t("form.notes")}</Label>
            <Textarea id="notes" rows={3} {...register("notes")} />
            <p className="mt-1 text-xs text-muted-foreground">{t("form.notesHint")}</p>
          </div>
        </div>
      </fieldset>

      {serverError ? <p role="alert" className="text-sm text-red-500">{serverError}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("form.saving") : t("form.save")}
        </Button>
        <Link
          href={isEdit ? `/app/hr/employees/${id}` : "/app/hr/employees"}
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("form.cancel")}
        </Link>
      </div>
    </form>
  );
}
