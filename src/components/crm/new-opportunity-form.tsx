"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { createOpportunity } from "@/app/actions/opportunities";

type Option = { id: string; name: string };
type ProductOption = { id: string; name: string; kind: "PRODUCT" | "SERVICE"; price: number | null };

type Values = {
  title: string;
  value: string;
  stageId: string;
  companyId: string;
  contactId: string;
  productServiceId: string;
  ownerId: string;
  expectedCloseDate: string;
  notes: string;
};

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

export function NewOpportunityForm({
  stages,
  companies,
  contacts,
  members,
  productServices,
  initialContactId,
  initialCompanyId,
  isMemberRole,
}: {
  stages: Option[];
  companies: Option[];
  contacts: Option[];
  members: Option[];
  productServices: ProductOption[];
  initialContactId?: string;
  initialCompanyId?: string;
  isMemberRole?: boolean;
}) {
  const t = useTranslations("crm.board");
  const tf = useTranslations("crm.opportunity");
  const tv = useTranslations("validation");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    defaultValues: {
      title: "",
      value: "",
      stageId: stages[0]?.id ?? "",
      companyId: initialCompanyId ?? "",
      contactId: initialContactId ?? "",
      productServiceId: "",
      ownerId: isMemberRole && members.length > 0 ? members[0].id : "",
      expectedCloseDate: "",
      notes: "",
    },
  });

  async function onSubmit(values: Values) {
    setServerError(null);
    const result = await createOpportunity({
      title: values.title.trim(),
      value: Number(values.value || 0),
      stageId: values.stageId,
      companyId: values.companyId,
      contactId: values.contactId,
      productServiceId: values.productServiceId,
      ownerId: values.ownerId,
      expectedCloseDate: values.expectedCloseDate,
      notes: values.notes,
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
            <Label htmlFor="title">{t("oppTitle")}</Label>
            <Input id="title" aria-invalid={Boolean(errors.title)} {...register("title", { required: tv("required") })} />
            <FieldError>{errors.title?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="value">{t("value")}</Label>
            <MoneyInput id="value" onValueChange={(n) => setValue("value", String(n))} />
            <input type="hidden" {...register("value")} />
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
      </fieldset>

      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{tf("details")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ownerId">{tf("owner")}</Label>
            <select id="ownerId" className={selectCls} {...register("ownerId")}>
              {!isMemberRole && <option value="">{tf("none")}</option>}
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="productServiceId">{tf("productService")}</Label>
            <select id="productServiceId" className={selectCls} {...register("productServiceId")}>
              <option value="">{tf("none")}</option>
              {productServices.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="expectedCloseDate">{tf("expectedCloseDate")}</Label>
            <Input id="expectedCloseDate" type="date" {...register("expectedCloseDate")} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">{tf("notes")}</Label>
            <Textarea id="notes" rows={3} {...register("notes")} />
          </div>
        </div>
      </fieldset>

      {serverError ? <p role="alert" className="text-sm text-red-500">{serverError}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("creating") : t("create")}
        </Button>
        <Link
          href="/app/crm"
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
