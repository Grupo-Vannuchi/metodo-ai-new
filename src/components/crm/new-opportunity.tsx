"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { createOpportunity } from "@/app/actions/opportunities";

type Option = { id: string; name: string };

type FormValues = {
  title: string;
  value: string;
  stageId: string;
  companyId: string;
  contactId: string;
};

export function NewOpportunity({
  stages,
  companies,
  contacts,
}: {
  stages: Option[];
  companies: Option[];
  contacts: Option[];
}) {
  const t = useTranslations("crm.board");
  const tv = useTranslations("validation");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const defaults: FormValues = {
    title: "",
    value: "",
    stageId: stages[0]?.id ?? "",
    companyId: "",
    contactId: "",
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: defaults });

  const selectCls = cn(
    "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
    "focus-visible:border-brand focus-visible:outline-none",
  );

  function close() {
    setServerError(null);
    reset(defaults);
    setOpen(false);
  }

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const result = await createOpportunity({
      title: values.title.trim(),
      value: Number(values.value || 0),
      stageId: values.stageId,
      companyId: values.companyId,
      contactId: values.contactId,
    });
    if (result.ok) {
      reset(defaults);
      setOpen(false);
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {t("newOpportunity")}
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={close}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("newOpportunity")}</h2>
              <button
                type="button"
                onClick={close}
                aria-label={t("cancel")}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
              <div className="sm:col-span-2">
                <Label htmlFor="title">{t("oppTitle")}</Label>
                <Input id="title" aria-invalid={Boolean(errors.title)} {...register("title", { required: tv("required") })} />
                <FieldError>{errors.title?.message}</FieldError>
              </div>
              <div>
                <Label htmlFor="value">{t("value")}</Label>
                <Input id="value" type="number" step="0.01" inputMode="decimal" {...register("value")} />
              </div>
              <div>
                <Label htmlFor="stageId">{t("stage")}</Label>
                <select id="stageId" className={selectCls} {...register("stageId", { required: true })}>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="companyId">{t("company")}</Label>
                <select id="companyId" className={selectCls} {...register("companyId")}>
                  <option value="">—</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="contactId">{t("contact")}</Label>
                <select id="contactId" className={selectCls} {...register("contactId")}>
                  <option value="">—</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {serverError ? (
                <p role="alert" className="text-sm text-red-500 sm:col-span-2">{serverError}</p>
              ) : null}

              <div className="mt-2 flex gap-3 sm:col-span-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? t("creating") : t("create")}
                </Button>
                <button
                  type="button"
                  onClick={close}
                  className="inline-flex h-11 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
