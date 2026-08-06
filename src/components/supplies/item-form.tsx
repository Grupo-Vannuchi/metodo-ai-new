"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { createSupplyItem, updateSupplyItem, deleteSupplyItem } from "@/app/actions/supply-items";
import { SUPPLY_ITEM_TYPES, PROPERTY_NATURES } from "@/lib/validations/supply-item";

type Option = { id: string; name: string };

export type ItemFormValues = {
  code: string;
  description: string;
  shortName: string;
  unit: string;
  category: string;
  brand: string;
  model: string;
  barcode: string;
  ncm: string;
  manufacturerCode: string;
  type: string;
  nature: string;
  controlsStock: boolean;
  controlsLot: boolean;
  controlsValidity: boolean;
  individualControl: boolean;
  canSell: boolean;
  canRent: boolean;
  canReserve: boolean;
  requiresCalibration: boolean;
  requiresMaintenance: boolean;
  critical: boolean;
  supplierId: string;
  leadTimeDays: string;
  minStock: string;
  maxStock: string;
  reorderPoint: string;
  lastCost: string;
  avgCost: string;
  salePrice: string;
  rentPrice: string;
  costCenter: string;
  defaultWarehouse: string;
  location: string;
  shelf: string;
  weight: string;
  dimensions: string;
  hazardous: boolean;
  logisticsNotes: string;
  calibrationPeriodMonths: string;
  maintenancePeriodMonths: string;
  warningDays: string;
  measurementRange: string;
  resolution: string;
  notes: string;
  active: boolean;
};

const FLAGS = [
  "controlsStock",
  "controlsLot",
  "controlsValidity",
  "individualControl",
  "canSell",
  "canRent",
  "canReserve",
  "requiresCalibration",
  "requiresMaintenance",
  "critical",
] as const;

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

export function ItemForm({
  id,
  defaults,
  suppliers,
}: {
  id?: string;
  defaults: ItemFormValues;
  suppliers: Option[];
}) {
  const t = useTranslations("supplies.items");
  const tv = useTranslations("validation");
  const router = useRouter();
  const confirm = useConfirm();
  const [serverError, setServerError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormValues>({ defaultValues: defaults });

  const requiresCalibration = watch("requiresCalibration");
  const requiresMaintenance = watch("requiresMaintenance");
  const canRent = watch("canRent");

  async function onSubmit(values: ItemFormValues) {
    setServerError(null);
    const res = id ? await updateSupplyItem(id, values) : await createSupplyItem(values);
    if (res.ok) {
      router.push("/app/supplies/items");
      router.refresh();
    } else {
      setServerError(t(`error.${res.error}`));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      {/* Bloco 1 — Identificação */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("blockIdentification")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <Label htmlFor="description">{t("description")}</Label>
            <Input id="description" aria-invalid={Boolean(errors.description)} {...register("description", { required: tv("required") })} />
            <FieldError>{errors.description?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="code">{t("code")}</Label>
            <Input id="code" {...register("code")} />
          </div>
          <div>
            <Label htmlFor="shortName">{t("shortName")}</Label>
            <Input id="shortName" {...register("shortName")} />
          </div>
          <div>
            <Label htmlFor="unit">{t("unit")}</Label>
            <Input id="unit" placeholder="un, kg, m…" {...register("unit")} />
          </div>
          <div>
            <Label htmlFor="category">{t("category")}</Label>
            <Input id="category" {...register("category")} />
          </div>
          <div>
            <Label htmlFor="brand">{t("brand")}</Label>
            <Input id="brand" {...register("brand")} />
          </div>
          <div>
            <Label htmlFor="model">{t("model")}</Label>
            <Input id="model" {...register("model")} />
          </div>
          <div>
            <Label htmlFor="barcode">{t("barcode")}</Label>
            <Input id="barcode" {...register("barcode")} />
          </div>
          <div>
            <Label htmlFor="ncm">{t("ncm")}</Label>
            <Input id="ncm" {...register("ncm")} />
          </div>
          <div>
            <Label htmlFor="manufacturerCode">{t("manufacturerCode")}</Label>
            <Input id="manufacturerCode" {...register("manufacturerCode")} />
          </div>
        </div>
      </fieldset>

      {/* Bloco 2 — Classificação */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("blockClassification")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="type">{t("type")}</Label>
            <select id="type" className={selectCls} {...register("type")}>
              {SUPPLY_ITEM_TYPES.map((v) => (
                <option key={v} value={v}>{t(`typeOpt.${v}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="nature">{t("nature")}</Label>
            <select id="nature" className={selectCls} {...register("nature")}>
              {PROPERTY_NATURES.map((v) => (
                <option key={v} value={v}>{t(`natureOpt.${v}`)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FLAGS.map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand" {...register(f)} />
              {t(`flag.${f}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Bloco 3 — Suprimento e custo */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("blockSupply")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="supplierId">{t("supplier")}</Label>
            <select id="supplierId" className={selectCls} {...register("supplierId")}>
              <option value="">{t("none")}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="leadTimeDays">{t("leadTimeDays")}</Label>
            <Input id="leadTimeDays" type="number" min={0} {...register("leadTimeDays")} />
          </div>
          <div>
            <Label htmlFor="costCenter">{t("costCenter")}</Label>
            <Input id="costCenter" {...register("costCenter")} />
          </div>
          <div>
            <Label htmlFor="minStock">{t("minStock")}</Label>
            <Input id="minStock" type="number" min={0} step="0.001" {...register("minStock")} />
          </div>
          <div>
            <Label htmlFor="maxStock">{t("maxStock")}</Label>
            <Input id="maxStock" type="number" min={0} step="0.001" {...register("maxStock")} />
          </div>
          <div>
            <Label htmlFor="reorderPoint">{t("reorderPoint")}</Label>
            <Input id="reorderPoint" type="number" min={0} step="0.001" {...register("reorderPoint")} />
          </div>
          <div>
            <Label htmlFor="lastCost">{t("lastCost")}</Label>
            <Input id="lastCost" type="number" min={0} step="0.01" {...register("lastCost")} />
          </div>
          <div>
            <Label htmlFor="avgCost">{t("avgCost")}</Label>
            <Input id="avgCost" type="number" min={0} step="0.01" {...register("avgCost")} />
          </div>
          <div>
            <Label htmlFor="salePrice">{t("salePrice")}</Label>
            <Input id="salePrice" type="number" min={0} step="0.01" {...register("salePrice")} />
          </div>
          {canRent ? (
            <div>
              <Label htmlFor="rentPrice">{t("rentPrice")}</Label>
              <Input id="rentPrice" type="number" min={0} step="0.01" {...register("rentPrice")} />
            </div>
          ) : null}
        </div>
      </fieldset>

      {/* Bloco 4 — Armazenamento */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("blockStorage")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="defaultWarehouse">{t("defaultWarehouse")}</Label>
            <Input id="defaultWarehouse" {...register("defaultWarehouse")} />
          </div>
          <div>
            <Label htmlFor="location">{t("location")}</Label>
            <Input id="location" {...register("location")} />
          </div>
          <div>
            <Label htmlFor="shelf">{t("shelf")}</Label>
            <Input id="shelf" {...register("shelf")} />
          </div>
          <div>
            <Label htmlFor="weight">{t("weight")}</Label>
            <Input id="weight" type="number" min={0} step="0.001" {...register("weight")} />
          </div>
          <div>
            <Label htmlFor="dimensions">{t("dimensions")}</Label>
            <Input id="dimensions" placeholder="AxLxP" {...register("dimensions")} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
            <input type="checkbox" className="size-4 accent-brand" {...register("hazardous")} />
            {t("hazardous")}
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <Label htmlFor="logisticsNotes">{t("logisticsNotes")}</Label>
            <Textarea id="logisticsNotes" rows={2} {...register("logisticsNotes")} />
          </div>
        </div>
      </fieldset>

      {/* Bloco 5 — Conformidade (condicional) */}
      {requiresCalibration || requiresMaintenance ? (
        <fieldset className="rounded-xl border border-border bg-card p-5">
          <legend className="px-1 text-sm font-medium">{t("blockCompliance")}</legend>
          <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {requiresCalibration ? (
              <div>
                <Label htmlFor="calibrationPeriodMonths">{t("calibrationPeriodMonths")}</Label>
                <Input id="calibrationPeriodMonths" type="number" min={0} {...register("calibrationPeriodMonths")} />
              </div>
            ) : null}
            {requiresMaintenance ? (
              <div>
                <Label htmlFor="maintenancePeriodMonths">{t("maintenancePeriodMonths")}</Label>
                <Input id="maintenancePeriodMonths" type="number" min={0} {...register("maintenancePeriodMonths")} />
              </div>
            ) : null}
            <div>
              <Label htmlFor="warningDays">{t("warningDays")}</Label>
              <Input id="warningDays" type="number" min={0} {...register("warningDays")} />
            </div>
            {requiresCalibration ? (
              <>
                <div>
                  <Label htmlFor="measurementRange">{t("measurementRange")}</Label>
                  <Input id="measurementRange" {...register("measurementRange")} />
                </div>
                <div>
                  <Label htmlFor="resolution">{t("resolution")}</Label>
                  <Input id="resolution" {...register("resolution")} />
                </div>
              </>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      {/* Observações + status */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <div className="grid gap-4">
          <div>
            <Label htmlFor="notes">{t("notes")}</Label>
            <Textarea id="notes" rows={3} {...register("notes")} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand" {...register("active")} />
            {t("active")}
          </label>
        </div>
      </fieldset>

      {serverError ? <p role="alert" className="text-sm text-red-500">{serverError}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("saving") : t("save")}
        </Button>
        <Link href="/app/supplies/items" className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground">
          {t("cancel")}
        </Link>
        {id ? (
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              if (!(await confirm({ description: t("deleteConfirm"), confirmLabel: t("delete"), variant: "danger" }))) return;
              startDelete(async () => {
                await deleteSupplyItem(id);
                router.push("/app/supplies/items");
                router.refresh();
              });
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            {t("delete")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
