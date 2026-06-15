"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import {
  formToCompanyInput,
  type CompanyFormValues,
} from "@/lib/company-form";
import {
  createCompany,
  updateCompany,
  type CompanyActionResult,
} from "@/app/actions/companies";

export function CompanyForm({
  mode,
  companyId,
  defaultValues,
}: {
  mode: "create" | "edit";
  companyId?: string;
  defaultValues: CompanyFormValues;
}) {
  const t = useTranslations("crm.companies");
  const tv = useTranslations("validation");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CompanyFormValues>({ defaultValues });

  async function onSubmit(values: CompanyFormValues) {
    setServerError(null);
    const input = formToCompanyInput(values);
    const result: CompanyActionResult =
      mode === "edit" && companyId
        ? await updateCompany(companyId, input)
        : await createCompany(input);

    if (result.ok) {
      router.push("/app/companies");
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">{t("sectionBasics")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="name">{t("name")}</Label>
            <Input id="name" aria-invalid={Boolean(errors.name)} {...register("name", { required: tv("required") })} />
            <FieldError>{errors.name?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="cnpj">{t("cnpj")}</Label>
            <Input id="cnpj" {...register("cnpj")} />
          </div>
          <div>
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" type="email" {...register("email")} />
          </div>
          <div>
            <Label htmlFor="phone">{t("phone")}</Label>
            <Input id="phone" {...register("phone")} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="website">{t("website")}</Label>
            <Input id="website" type="url" placeholder="https://…" aria-invalid={Boolean(errors.website)} {...register("website")} />
            <FieldError>{errors.website?.message}</FieldError>
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">{t("sectionAddress")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="street">{t("street")}</Label>
            <Input id="street" {...register("street")} />
          </div>
          <div>
            <Label htmlFor="city">{t("city")}</Label>
            <Input id="city" {...register("city")} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="uf">{t("uf")}</Label>
              <Input id="uf" maxLength={2} {...register("uf")} />
            </div>
            <div>
              <Label htmlFor="zip">{t("zip")}</Label>
              <Input id="zip" {...register("zip")} />
            </div>
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">{t("notes")}</legend>
        <Textarea id="notes" {...register("notes")} />
      </fieldset>

      {serverError ? (
        <p role="alert" className="text-sm text-red-500">{serverError}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("saving") : mode === "create" ? t("create") : t("save")}
        </Button>
        <Link
          href="/app/companies"
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
