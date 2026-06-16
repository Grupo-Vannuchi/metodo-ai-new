"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { formatBrPhone, isValidBrPhone } from "@/lib/phone";
import {
  formToContactInput,
  type ContactFormValues,
} from "@/lib/contact-form";
import {
  createContact,
  updateContact,
  type ContactActionResult,
} from "@/app/actions/contacts";

export function ContactForm({
  mode,
  contactId,
  defaultValues,
  companies,
}: {
  mode: "create" | "edit";
  contactId?: string;
  defaultValues: ContactFormValues;
  companies: { id: string; name: string }[];
}) {
  const t = useTranslations("crm.contacts");
  const tv = useTranslations("validation");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    defaultValues: { ...defaultValues, phone: formatBrPhone(defaultValues.phone) },
  });

  // Mask the phone field as the user types and keep RHF's value in sync.
  const phoneField = register("phone", {
    validate: (v) => isValidBrPhone(v) || tv("phone"),
  });

  async function onSubmit(values: ContactFormValues) {
    setServerError(null);
    const input = formToContactInput(values);
    const result: ContactActionResult =
      mode === "edit" && contactId
        ? await updateContact(contactId, input)
        : await createContact(input);

    if (result.ok) {
      router.push("/app/contacts");
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  const selectCls = cn(
    "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
    "focus-visible:border-brand focus-visible:outline-none",
  );

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
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" type="email" {...register("email")} />
          </div>
          <div>
            <Label htmlFor="phone">{t("phone")}</Label>
            <Input
              id="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 91234-5678"
              aria-invalid={Boolean(errors.phone)}
              {...phoneField}
              onChange={(e) => {
                e.target.value = formatBrPhone(e.target.value);
                phoneField.onChange(e);
              }}
            />
            <FieldError>{errors.phone?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="role">{t("role")}</Label>
            <Input id="role" {...register("role")} />
          </div>
          <div>
            <Label htmlFor="companyId">{t("company")}</Label>
            <select id="companyId" className={selectCls} {...register("companyId")}>
              <option value="">{t("noCompany")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="tags">{t("tags")}</Label>
            <Input id="tags" placeholder="lead, quente, sp" {...register("tags")} />
            <p className="mt-1 text-xs text-muted-foreground">{t("tagsHint")}</p>
          </div>
          <label className="flex items-center gap-3 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-brand" {...register("optedOut")} />
            {t("optedOut")}
          </label>
        </div>
      </fieldset>

      {serverError ? (
        <p role="alert" className="text-sm text-red-500">{serverError}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("saving") : mode === "create" ? t("create") : t("save")}
        </Button>
        <Link
          href="/app/contacts"
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
