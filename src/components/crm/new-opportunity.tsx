"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { title: "", value: "", stageId: stages[0]?.id ?? "", companyId: "", contactId: "" },
  });

  const selectCls = cn(
    "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
    "focus-visible:border-brand focus-visible:outline-none",
  );

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
      reset({ title: "", value: "", stageId: stages[0]?.id ?? "", companyId: "", contactId: "" });
      setOpen(false);
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {t("newOpportunity")}
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-xl border border-border bg-card p-5"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>

      {serverError ? (
        <p role="alert" className="mt-3 text-sm text-red-500">{serverError}</p>
      ) : null}

      <div className="mt-4 flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("creating") : t("create")}
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-11 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
