"use client";

import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { SearchSelect } from "@/components/ui/search-select";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useRegisterAssistantForm } from "@/components/app/assistant/form-store";
import type { FormBridge } from "@/lib/assistant/form-bridge";
import { createOpportunity } from "@/app/actions/opportunities";
import { PipelineStageFields, type PipelineOption } from "@/components/crm/pipeline-stage-fields";

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
  pipelines,
  initialPipelineId,
  companies,
  contacts,
  members,
  productServices,
  initialContactId,
  initialCompanyId,
  isMemberRole,
}: {
  pipelines: PipelineOption[];
  initialPipelineId: string;
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
    control,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    defaultValues: {
      title: "",
      value: "",
      stageId: pipelines.find((p) => p.id === initialPipelineId)?.stages[0]?.id ?? "",
      companyId: initialCompanyId ?? "",
      contactId: initialContactId ?? "",
      productServiceId: "",
      ownerId: isMemberRole && members.length > 0 ? members[0].id : "",
      expectedCloseDate: "",
      notes: "",
    },
  });
  const stageId = useWatch({ control, name: "stageId" });
  const companyId = useWatch({ control, name: "companyId" });
  const contactId = useWatch({ control, name: "contactId" });
  const ownerId = useWatch({ control, name: "ownerId" });
  const productServiceId = useWatch({ control, name: "productServiceId" });

  // AI copilot pre-fill (review only; never saves). Money/company/contact/owner
  // stay with the user (uncontrolled money input / need real ids).
  const bridge = useMemo<FormBridge>(
    () => ({
      key: "opportunity:new",
      title: "Nova oportunidade",
      fields: [
        { name: "title", label: "Título", type: "text" },
        { name: "notes", label: "Notas / contexto", type: "textarea" },
        { name: "expectedCloseDate", label: "Previsão de fechamento", type: "date" },
        {
          name: "stageId",
          label: "Etapa do funil",
          type: "select",
          options: pipelines.flatMap((p) =>
            p.stages.map((s) => ({ value: s.id, label: `${p.name} › ${s.name}` })),
          ),
        },
      ],
      apply: (values) => {
        const set = setValue as unknown as (
          name: keyof Values,
          value: string,
          opts: { shouldDirty: boolean; shouldTouch: boolean },
        ) => void;
        const FIELDS = new Set(["title", "notes", "expectedCloseDate", "stageId"]);
        for (const [k, v] of Object.entries(values)) {
          if (FIELDS.has(k)) set(k as keyof Values, v, { shouldDirty: true, shouldTouch: true });
        }
      },
    }),
    [pipelines, setValue],
  );
  useRegisterAssistantForm(bridge);

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
          <PipelineStageFields
            pipelines={pipelines}
            stageId={stageId}
            onStageChange={(next) => setValue("stageId", next, { shouldDirty: true })}
            pipelineLabel={t("pipeline")}
            stageLabel={t("stage")}
            selectClassName={selectCls}
          />
          <div>
            <Label htmlFor="value">{t("value")}</Label>
            <MoneyInput id="value" onValueChange={(n) => setValue("value", String(n))} />
            <input type="hidden" {...register("value")} />
          </div>
          <div className="hidden sm:block" />

          <div>
            <Label htmlFor="companyId">{t("company")}</Label>
            <SearchSelect
              id="companyId"
              options={companies}
              value={companyId}
              onChange={(next) => setValue("companyId", next, { shouldDirty: true })}
            />
          </div>

          <div>
            <Label htmlFor="contactId">{t("contact")}</Label>
            <SearchSelect
              id="contactId"
              options={contacts}
              value={contactId}
              onChange={(next) => setValue("contactId", next, { shouldDirty: true })}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{tf("details")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ownerId">{tf("owner")}</Label>
            <SearchSelect
              id="ownerId"
              options={members}
              value={ownerId}
              onChange={(next) => setValue("ownerId", next, { shouldDirty: true })}
              clearable={!isMemberRole}
            />
          </div>
          <div>
            <Label htmlFor="productServiceId">{tf("productService")}</Label>
            <SearchSelect
              id="productServiceId"
              options={productServices}
              value={productServiceId}
              onChange={(next) => setValue("productServiceId", next, { shouldDirty: true })}
            />
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
