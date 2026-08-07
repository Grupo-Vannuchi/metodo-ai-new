"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { useNotify } from "@/components/ui/toast";
import { createAsset, updateAsset } from "@/app/actions/assets";
import { ASSET_STATUSES } from "@/components/supplies/asset-status";
import { ASSET_NATURES } from "@/lib/validations/asset";
import type { AssetFormOptions, AssetDetail } from "@/lib/queries/assets";

export type AssetFormValues = {
  code: string;
  name: string;
  itemId: string;
  serialNumber: string;
  nature: string;
  status: string;
  supplierId: string;
  warehouseId: string;
  location: string;
  custodian: string;
  ownerCompanyId: string;
  acquisitionDate: string;
  acquisitionValue: string;
  notes: string;
  active: boolean;
};

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

const str = (v: string | null | undefined) => v ?? "";
const num = (v: number | null | undefined) => (v == null ? "" : String(v));

function toDefaults(a?: AssetDetail): AssetFormValues {
  return {
    code: str(a?.code),
    name: str(a?.name),
    itemId: str(a?.itemId),
    serialNumber: str(a?.serialNumber),
    nature: a?.nature ?? "OWN",
    status: a?.status ?? "AVAILABLE",
    supplierId: str(a?.supplierId),
    warehouseId: str(a?.warehouseId),
    location: str(a?.location),
    custodian: str(a?.custodian),
    ownerCompanyId: str(a?.ownerCompanyId),
    acquisitionDate: a?.acquisitionDate ? new Date(a.acquisitionDate).toISOString().slice(0, 10) : "",
    acquisitionValue: num(a?.acquisitionValue),
    notes: str(a?.notes),
    active: a?.active ?? true,
  };
}

export function AssetForm({
  options,
  initial,
  onDone,
  onCancel,
}: {
  options: AssetFormOptions;
  initial?: AssetDetail;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("supplies.assets");
  const router = useRouter();
  const notify = useNotify();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<AssetFormValues>({ defaultValues: toDefaults(initial) });

  function onSubmit(values: AssetFormValues) {
    setError(null);
    start(async () => {
      const res = initial ? await updateAsset(initial.id, values) : await createAsset(values);
      if (res.ok) {
        notify("saved");
        if (onDone) onDone();
        else router.push("/app/supplies/assets");
        router.refresh();
      } else {
        setError(t(`error.${res.error}`));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">{t("blockIdentification")}</legend>
        <div>
          <Label htmlFor="code">{t("code")}</Label>
          <Input id="code" {...register("code")} maxLength={60} />
        </div>
        <div>
          <Label htmlFor="name">{t("name")}</Label>
          <Input id="name" {...register("name", { required: true })} maxLength={240} required />
        </div>
        <div>
          <Label htmlFor="itemId">{t("item")}</Label>
          <select id="itemId" className={selectCls} {...register("itemId")}>
            <option value="">{t("noItem")}</option>
            {options.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="serialNumber">{t("serialNumber")}</Label>
          <Input id="serialNumber" {...register("serialNumber")} maxLength={120} />
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">{t("blockClassification")}</legend>
        <div>
          <Label htmlFor="nature">{t("natureLabel")}</Label>
          <select id="nature" className={selectCls} {...register("nature")}>
            {ASSET_NATURES.map((n) => (
              <option key={n} value={n}>
                {t(`nature.${n}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="status">{t("statusLabel")}</Label>
          <select id="status" className={selectCls} {...register("status")}>
            {ASSET_STATUSES.map((skey) => (
              <option key={skey} value={skey}>
                {t(`status.${skey}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="ownerCompanyId">{t("ownerCompany")}</Label>
          <select id="ownerCompanyId" className={selectCls} {...register("ownerCompanyId")}>
            <option value="">{t("noOwnerCompany")}</option>
            {options.companies.map((co) => (
              <option key={co.id} value={co.id}>
                {co.name}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">{t("blockAcquisition")}</legend>
        <div>
          <Label htmlFor="supplierId">{t("supplier")}</Label>
          <select id="supplierId" className={selectCls} {...register("supplierId")}>
            <option value="">{t("noSupplier")}</option>
            {options.suppliers.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="acquisitionDate">{t("acquisitionDate")}</Label>
          <Input id="acquisitionDate" type="date" {...register("acquisitionDate")} />
        </div>
        <div>
          <Label htmlFor="acquisitionValue">{t("acquisitionValue")}</Label>
          <Input id="acquisitionValue" type="number" step="0.01" min="0" inputMode="decimal" {...register("acquisitionValue")} />
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">{t("blockLocation")}</legend>
        <div>
          <Label htmlFor="warehouseId">{t("warehouse")}</Label>
          <select id="warehouseId" className={selectCls} {...register("warehouseId")}>
            <option value="">{t("noWarehouse")}</option>
            {options.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="location">{t("location")}</Label>
          <Input id="location" {...register("location")} maxLength={160} />
        </div>
        <div>
          <Label htmlFor="custodian">{t("custodian")}</Label>
          <Input id="custodian" {...register("custodian")} maxLength={160} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">{t("blockNotes")}</legend>
        <div>
          <Label htmlFor="notes">{t("notes")}</Label>
          <Textarea id="notes" rows={3} {...register("notes")} maxLength={2000} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("active")} className="size-4 accent-brand" />
          {t("active")}
        </label>
      </fieldset>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <button
          type="button"
          onClick={() => (onCancel ? onCancel() : router.back())}
          className="inline-flex items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
