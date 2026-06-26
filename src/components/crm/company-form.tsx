"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import { onlyDigits, formatCnpj } from "@/lib/cnpj";
import {
  formToCompanyInput,
  type CompanyFormValues,
} from "@/lib/company-form";
import {
  createCompany,
  updateCompany,
  lookupCnpj,
  type CompanyActionResult,
} from "@/app/actions/companies";

type CnpjState = "idle" | "loading" | "done" | "notFound" | "error";

/** Form fields the CNPJ lookup can populate (only the empty ones get filled). */
const CNPJ_FILLABLE = ["name", "email", "phone", "street", "city", "uf", "zip"] as const;

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

  const [cnpjState, setCnpjState] = useState<CnpjState>("idle");

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<CompanyFormValues>({ defaultValues });

  async function runCnpjLookup() {
    const digits = onlyDigits(getValues("cnpj"));
    if (digits.length !== 14) return;
    setCnpjState("loading");
    const result = await lookupCnpj(digits);
    if (!result.ok) {
      setCnpjState(result.error === "notFound" ? "notFound" : "error");
      return;
    }
    setValue("cnpj", formatCnpj(digits));
    for (const key of CNPJ_FILLABLE) {
      const incoming = result.data[key];
      // Only fill blanks — never clobber what the user already typed.
      if (incoming && !getValues(key).trim()) {
        setValue(key, incoming, { shouldDirty: true, shouldValidate: true });
      }
    }
    setCnpjState("done");
  }

  async function onSubmit(values: CompanyFormValues) {
    setServerError(null);
    const input = formToCompanyInput(values);
    const result: CompanyActionResult =
      mode === "edit" && companyId
        ? await updateCompany(companyId, input)
        : await createCompany(input);

    if (result.ok) {
      router.push(mode === "edit" && companyId ? `/app/companies/${companyId}` : "/app/companies");
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
            <div className="relative">
              <Input
                id="cnpj"
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                className="pr-10"
                {...register("cnpj", {
                  onChange: () => setCnpjState((s) => (s === "idle" ? s : "idle")),
                  onBlur: () => {
                    if (cnpjState === "idle") void runCnpjLookup();
                  },
                })}
              />
              <button
                type="button"
                onClick={() => void runCnpjLookup()}
                disabled={cnpjState === "loading"}
                title={t("cnpjLookup")}
                aria-label={t("cnpjLookup")}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {cnpjState === "loading" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
              </button>
            </div>
            {cnpjState === "done" ? (
              <p className="mt-1 text-xs text-green-600 dark:text-green-400">{t("cnpjFilled")}</p>
            ) : cnpjState === "notFound" ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t("cnpjNotFound")}</p>
            ) : cnpjState === "error" ? (
              <p className="mt-1 text-xs text-red-500">{t("cnpjError")}</p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t("cnpjHint")}</p>
            )}
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
          href={mode === "edit" && companyId ? `/app/companies/${companyId}` : "/app/companies"}
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
