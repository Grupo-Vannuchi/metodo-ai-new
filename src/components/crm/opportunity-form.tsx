"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Trash2, Wallet } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { updateOpportunity, deleteOpportunity } from "@/app/actions/opportunities";

type Option = { id: string; name: string };
type ProductOption = { id: string; name: string; kind: "PRODUCT" | "SERVICE"; price: number | null };

type Values = {
  title: string;
  value: string;
  stageId: string;
  status: "OPEN" | "WON" | "LOST" | "CANCELED";
  companyId: string;
  contactId: string;
  productServiceId: string;
  ownerId: string;
  expectedCloseDate: string;
  notes: string;
  outcomeReason: string;
};

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

export function OpportunityForm({
  id,
  code,
  defaultValues,
  stages,
  companies,
  contacts,
  members,
  productServices,
  canFinance,
}: {
  id: string;
  code: string | null;
  defaultValues: Values;
  stages: Option[];
  companies: Option[];
  contacts: Option[];
  members: Option[];
  productServices: ProductOption[];
  canFinance: boolean;
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
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ defaultValues });

  const status = watch("status");
  const needsReason = status === "LOST" || status === "CANCELED";

  async function onSubmit(values: Values) {
    setServerError(null);
    const result = await updateOpportunity(id, {
      title: values.title.trim(),
      value: Number(values.value || 0),
      stageId: values.stageId,
      status: values.status,
      companyId: values.companyId,
      contactId: values.contactId,
      productServiceId: values.productServiceId,
      ownerId: values.ownerId,
      expectedCloseDate: values.expectedCloseDate,
      notes: values.notes,
      outcomeReason: values.outcomeReason,
    });
    if (result.ok) {
      // Stay on the deal when it's just been won, so the "generate entry" CTA shows.
      router.push(values.status === "WON" ? `/app/crm/${id}` : "/app/crm");
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  // Pre-fill the finance entry from the won deal (review-before-save flow).
  const financeHref = (() => {
    const today = new Date().toISOString().slice(0, 10);
    const desc = `${code ? `${code} - ` : ""}${defaultValues.title}`;
    const p = new URLSearchParams({
      type: "INCOME",
      description: desc,
      amount: defaultValues.value || "0",
      opportunityId: id,
      dueDate: today,
    });
    if (defaultValues.contactId) p.set("contactId", defaultValues.contactId);
    if (defaultValues.companyId) p.set("companyId", defaultValues.companyId);
    return `/app/finance/entries/new?${p.toString()}`;
  })();

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      {defaultValues.status === "WON" && canFinance ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-500/40 bg-green-500/5 p-4">
          <div>
            <p className="text-sm font-medium">{t("wonTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("wonHint")}</p>
          </div>
          <Link href={financeHref} className={buttonVariants({ size: "sm" })}>
            <Wallet className="size-4" />
            {t("generateEntry")}
          </Link>
        </div>
      ) : null}

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
              <option value="CANCELED">{t("statusCANCELED")}</option>
            </select>
          </div>
          {needsReason ? (
            <div>
              <Label htmlFor="outcomeReason">{t("outcomeReason")}</Label>
              <Input
                id="outcomeReason"
                aria-invalid={Boolean(errors.outcomeReason)}
                {...register("outcomeReason", { required: tv("required") })}
              />
              <FieldError>{errors.outcomeReason?.message}</FieldError>
            </div>
          ) : (
            <div />
          )}
          <div>
            <Label htmlFor="companyId">{t("company")}</Label>
            <select id="companyId" className={selectCls} {...register("companyId")}>
              <option value="">{t("none")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
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

      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("details")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ownerId">{t("owner")}</Label>
            <select id="ownerId" className={selectCls} {...register("ownerId")}>
              <option value="">{t("none")}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="productServiceId">{t("productService")}</Label>
            <select id="productServiceId" className={selectCls} {...register("productServiceId")}>
              <option value="">{t("none")}</option>
              {productServices.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="expectedCloseDate">{t("expectedCloseDate")}</Label>
            <Input id="expectedCloseDate" type="date" {...register("expectedCloseDate")} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">{t("notes")}</Label>
            <Textarea id="notes" rows={3} {...register("notes")} />
          </div>
        </div>
      </fieldset>

      {serverError ? <p role="alert" className="text-sm text-red-500">{serverError}</p> : null}

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
