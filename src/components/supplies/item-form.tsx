"use client";

import { useState, useTransition } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Trash2, ChevronDown, ChevronUp } from "lucide-react";
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

type FlagKey =
  | "controlsStock"
  | "canSell"
  | "canRent"
  | "individualControl"
  | "canReserve"
  | "controlsLot"
  | "controlsValidity"
  | "requiresCalibration"
  | "requiresMaintenance"
  | "critical";

const ESSENTIAL_FLAGS: FlagKey[] = ["controlsStock", "canSell", "canRent"];
const ADVANCED_FLAGS: FlagKey[] = [
  "individualControl",
  "canReserve",
  "controlsLot",
  "controlsValidity",
  "requiresCalibration",
  "requiresMaintenance",
  "critical",
];

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

/** A label + switch row for a boolean flag. */
function Toggle({ label, reg }: { label: string; reg: UseFormRegisterReturn }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-brand/40">
      <span className="text-sm">{label}</span>
      <span className="relative inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" {...reg} />
        <span className="h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-brand" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {title ? <h3 className="mb-3 text-sm font-medium">{title}</h3> : null}
      {children}
    </div>
  );
}

/** True when an item already carries data beyond the essentials (edit view). */
function hasAdvancedData(v: ItemFormValues): boolean {
  const filledText = [
    v.code,
    v.brand,
    v.model,
    v.barcode,
    v.ncm,
    v.manufacturerCode,
    v.shortName,
    v.supplierId,
    v.minStock,
    v.maxStock,
    v.reorderPoint,
    v.lastCost,
    v.avgCost,
    v.rentPrice,
    v.costCenter,
    v.leadTimeDays,
    v.defaultWarehouse,
    v.location,
    v.shelf,
    v.weight,
    v.dimensions,
    v.logisticsNotes,
    v.notes,
  ].some((x) => x && x.trim());
  const flagsOn = ADVANCED_FLAGS.some((f) => v[f]) || v.hazardous;
  return filledText || flagsOn;
}

export function ItemForm({
  id,
  defaults,
  suppliers,
  categories = [],
  units = [],
  warehouses = [],
}: {
  id?: string;
  defaults: ItemFormValues;
  suppliers: Option[];
  categories?: string[];
  units?: string[];
  warehouses?: string[];
}) {
  const t = useTranslations("supplies.items");
  const tv = useTranslations("validation");
  const router = useRouter();
  const confirm = useConfirm();
  const [serverError, setServerError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const [advanced, setAdvanced] = useState(() => Boolean(id) && hasAdvancedData(defaults));

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormValues>({ defaultValues: defaults });

  const type = watch("type");
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
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <datalist id="supply-units">
        {units.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <datalist id="supply-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="supply-warehouses">
        {warehouses.map((w) => (
          <option key={w} value={w} />
        ))}
      </datalist>

      {/* Essencial — visível sempre */}
      <SectionCard title={t("blockEssential")}>
        <div className="grid gap-4">
          <div>
            <Label htmlFor="description">{t("description")}</Label>
            <Input id="description" aria-invalid={Boolean(errors.description)} {...register("description", { required: tv("required") })} />
            <FieldError>{errors.description?.message}</FieldError>
          </div>

          <div>
            <Label htmlFor="type">{t("type")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {SUPPLY_ITEM_TYPES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setValue("type", v, { shouldDirty: true })}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                    type === v
                      ? "border-brand bg-brand/10 font-medium text-brand"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t(`typeOpt.${v}`)}
                </button>
              ))}
            </div>
            <input type="hidden" {...register("type")} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="unit">{t("unit")}</Label>
              <Input id="unit" list="supply-units" placeholder="un, kg, m…" {...register("unit")} />
            </div>
            <div>
              <Label htmlFor="category">{t("category")}</Label>
              <Input id="category" list="supply-categories" {...register("category")} />
            </div>
            <div>
              <Label htmlFor="salePrice">{t("salePrice")}</Label>
              <Input id="salePrice" type="number" min={0} step="0.01" {...register("salePrice")} />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {ESSENTIAL_FLAGS.map((f) => (
              <Toggle key={f} label={t(`flag.${f}`)} reg={register(f)} />
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Toggle avançado */}
      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-sm font-medium text-brand transition-colors hover:bg-brand/10"
      >
        {advanced ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        {advanced ? t("hideAdvanced") : t("showAdvanced")}
      </button>

      {advanced ? (
        <>
          {/* Identificação */}
          <SectionCard title={t("blockIdentification")}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="code">{t("code")}</Label>
                <Input id="code" {...register("code")} />
              </div>
              <div>
                <Label htmlFor="shortName">{t("shortName")}</Label>
                <Input id="shortName" {...register("shortName")} />
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
          </SectionCard>

          {/* Classificação avançada */}
          <SectionCard title={t("blockClassification")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="nature">{t("nature")}</Label>
                <select id="nature" className={selectCls} {...register("nature")}>
                  {PROPERTY_NATURES.map((v) => (
                    <option key={v} value={v}>
                      {t(`natureOpt.${v}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ADVANCED_FLAGS.map((f) => (
                <Toggle key={f} label={t(`flag.${f}`)} reg={register(f)} />
              ))}
            </div>
          </SectionCard>

          {/* Suprimento e custo */}
          <SectionCard title={t("blockSupply")}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="supplierId">{t("supplier")}</Label>
                <select id="supplierId" className={selectCls} {...register("supplierId")}>
                  <option value="">{t("none")}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
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
              {canRent ? (
                <div>
                  <Label htmlFor="rentPrice">{t("rentPrice")}</Label>
                  <Input id="rentPrice" type="number" min={0} step="0.01" {...register("rentPrice")} />
                </div>
              ) : null}
            </div>
          </SectionCard>

          {/* Armazenamento */}
          <SectionCard title={t("blockStorage")}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="defaultWarehouse">{t("defaultWarehouse")}</Label>
                <Input id="defaultWarehouse" list="supply-warehouses" {...register("defaultWarehouse")} />
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
              <div className="self-end">
                <Toggle label={t("hazardous")} reg={register("hazardous")} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Label htmlFor="logisticsNotes">{t("logisticsNotes")}</Label>
                <Textarea id="logisticsNotes" rows={2} {...register("logisticsNotes")} />
              </div>
            </div>
          </SectionCard>

          {/* Conformidade (condicional) */}
          {requiresCalibration || requiresMaintenance ? (
            <SectionCard title={t("blockCompliance")}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            </SectionCard>
          ) : null}

          {/* Observações + status */}
          <SectionCard>
            <div className="grid gap-4">
              <div>
                <Label htmlFor="notes">{t("notes")}</Label>
                <Textarea id="notes" rows={3} {...register("notes")} />
              </div>
              <Toggle label={t("active")} reg={register("active")} />
            </div>
          </SectionCard>
        </>
      ) : null}

      {serverError ? (
        <p role="alert" className="text-sm text-red-500">
          {serverError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("saving") : t("save")}
        </Button>
        <Link
          href="/app/supplies/items"
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
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
