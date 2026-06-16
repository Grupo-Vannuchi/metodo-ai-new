"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import { PROVIDERS, type IntegrationProviderKey } from "@/lib/integrations/registry";
import { updateConnection } from "@/app/actions/connections";

type FormValues = { label: string; credentials: Record<string, string> };

export function ConnectionEditForm({
  id,
  provider,
  label,
  credentials,
}: {
  id: string;
  provider: IntegrationProviderKey;
  label: string;
  credentials: Record<string, string>;
}) {
  const t = useTranslations("connections");
  const tv = useTranslations("validation");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const spec = PROVIDERS[provider];

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { label, credentials } });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const creds: Record<string, string> = {};
    for (const f of spec.fields) {
      creds[f.key] = (values.credentials?.[f.key] ?? "").trim();
    }
    const result = await updateConnection(id, { label: values.label.trim(), credentials: creds });
    if (result.ok) {
      router.push(`/app/connections/${id}`);
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">{t("sectionProvider")}</legend>
        <div className="grid gap-4">
          <div>
            <Label>{t("provider")}</Label>
            <p className="mt-1 text-sm text-muted-foreground">{spec.label}</p>
          </div>
          <div>
            <Label htmlFor="label">{t("label")}</Label>
            <Input id="label" aria-invalid={Boolean(errors.label)} {...register("label", { required: tv("required") })} />
            <FieldError>{errors.label?.message}</FieldError>
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">{t("sectionCredentials")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {spec.fields.map((f) => (
            <div key={f.key} className={f.type === "url" ? "sm:col-span-2" : ""}>
              <Label htmlFor={`cred-${f.key}`}>
                {f.label}
                {f.required ? " *" : ""}
              </Label>
              <Input
                id={`cred-${f.key}`}
                type={f.type === "password" ? "password" : f.type === "url" ? "url" : "text"}
                placeholder={f.type === "password" ? t("keepSecret") : f.placeholder}
                autoComplete="off"
                {...register(`credentials.${f.key}` as const)}
              />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("keepSecret")}</p>
      </fieldset>

      {serverError ? (
        <p role="alert" className="text-sm text-red-500">{serverError}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("saving") : t("save")}
        </Button>
        <Link
          href={`/app/connections/${id}`}
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
