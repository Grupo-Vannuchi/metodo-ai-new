"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { updateOpportunity, deleteOpportunity } from "@/app/actions/opportunities";

type Option = { id: string; name: string };
type Values = {
  title: string;
  value: string;
  stageId: string;
  status: "OPEN" | "WON" | "LOST";
  companyId: string;
  contactId: string;
};

export function OpportunityForm({
  id,
  defaultValues,
  stages,
  companies,
  contacts,
}: {
  id: string;
  defaultValues: Values;
  stages: Option[];
  companies: Option[];
  contacts: Option[];
}) {
  const t = useTranslations("crm.opportunity");
  const tv = useTranslations("validation");
  const router = useRouter();
  const confirm = useConfirm();
  const [serverError, setServerError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ defaultValues });

  const selectCls = cn(
    "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
    "focus-visible:border-brand focus-visible:outline-none",
  );

  async function onSubmit(values: Values) {
    setServerError(null);
    const result = await updateOpportunity(id, {
      title: values.title.trim(),
      value: Number(values.value || 0),
      stageId: values.stageId,
      status: values.status,
      companyId: values.companyId,
      contactId: values.contactId,
    });
    if (result.ok) {
      router.push("/app/crm");
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="title">{t("title")}</Label>
            <Input id="title" aria-invalid={Boolean(errors.title)} {...register("title", { required: tv("required") })} />
            <FieldError>{errors.title?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="value">{t("value")}</Label>
            <MoneyInput
              id="value"
              defaultValue={Number(defaultValues.value) || 0}
              onValueChange={(n) => setValue("value", String(n))}
            />
            <input type="hidden" {...register("value")} />
          </div>
          <div>
            <Label htmlFor="stageId">{t("stage")}</Label>
            <select id="stageId" className={selectCls} {...register("stageId")}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="status">{t("status")}</Label>
            <select id="status" className={selectCls} {...register("status")}>
              <option value="OPEN">{t("statusOPEN")}</option>
              <option value="WON">{t("statusWON")}</option>
              <option value="LOST">{t("statusLOST")}</option>
            </select>
          </div>
          <div>
            <Label htmlFor="companyId">{t("company")}</Label>
            <select id="companyId" className={selectCls} {...register("companyId")}>
              <option value="">{t("none")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="contactId">{t("contact")}</Label>
            <select id="contactId" className={selectCls} {...register("contactId")}>
              <option value="">{t("none")}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      {serverError ? (
        <p role="alert" className="text-sm text-red-500">{serverError}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("saving") : t("save")}
        </Button>
        <Link
          href="/app/crm"
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("cancel")}
        </Link>
        <button
          type="button"
          disabled={deleting}
          onClick={async () => {
            if (!(await confirm({ description: t("confirmDelete"), confirmLabel: t("delete"), variant: "danger" }))) return;
            startDelete(async () => {
              await deleteOpportunity(id);
              router.push("/app/crm");
              router.refresh();
            });
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 className="size-4" />
          {t("delete")}
        </button>
      </div>
    </form>
  );
}
