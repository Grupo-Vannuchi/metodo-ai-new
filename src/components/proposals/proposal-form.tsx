"use client";

import { useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { createProposal, updateProposal } from "@/app/actions/proposals";
import type { ProposalFormOptions } from "@/lib/queries/proposals";
import type { ProposalStatusKey } from "@/lib/validations/proposal";
import { useRegisterAssistantForm } from "@/components/app/assistant/form-store";
import type { FormBridge } from "@/lib/assistant/form-bridge";

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

type Scalars = {
  title: string;
  companyId: string;
  contactId: string;
  clientCompany: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
  validUntil: string;
  intro: string;
  notes: string;
  status: ProposalStatusKey;
};

type ItemRow = {
  key: string;
  rev: number; // bumped to re-seed the money input when the price is set programmatically
  productServiceId: string;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

export type ProposalFormDefaults = Scalars & {
  opportunityId: string;
  discount: number;
  items: {
    productServiceId: string;
    name: string;
    description: string;
    quantity: number;
    unitPrice: number;
  }[];
};

const STATUSES: ProposalStatusKey[] = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"];

export function ProposalForm({
  id,
  defaults,
  options,
}: {
  id?: string; // present = edit mode
  defaults: ProposalFormDefaults;
  options: ProposalFormOptions;
}) {
  const t = useTranslations("proposals");
  const tv = useTranslations("validation");
  const router = useRouter();
  const isEdit = Boolean(id);

  // Row-key counter — only read in event handlers (never during render).
  const seq = useRef(defaults.items.length);
  const newKey = () => `row-${seq.current++}`;

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Scalars>({ defaultValues: defaults });

  const [serverError, setServerError] = useState<string | null>(null);
  const [discount, setDiscount] = useState(defaults.discount);
  const [items, setItems] = useState<ItemRow[]>(() =>
    defaults.items.map((it, i) => ({ key: `init-${i}`, rev: 0, ...it })),
  );

  // Let the AI copilot pre-fill this proposal for review (it never saves). Text
  // scalars go through RHF setValue; line items are passed as a JSON string and
  // rebuilt into the items state (the money inputs re-key, so prices show).
  const bridge = useMemo<FormBridge>(
    () => ({
      key: `proposal:${id ?? "new"}`,
      title: "Proposta",
      fields: [
        { name: "title", label: "Título da proposta", type: "text" },
        { name: "clientCompany", label: "Empresa do cliente", type: "text" },
        { name: "clientName", label: "Nome do cliente", type: "text" },
        { name: "clientEmail", label: "E-mail do cliente", type: "text" },
        { name: "clientPhone", label: "Telefone do cliente", type: "text" },
        { name: "clientAddress", label: "Endereço do cliente", type: "text" },
        { name: "validUntil", label: "Válida até", type: "date" },
        { name: "intro", label: "Introdução", type: "textarea" },
        { name: "notes", label: "Observações", type: "textarea" },
        {
          name: "items",
          label: "Itens (JSON)",
          type: "textarea",
          description:
            'Itens da proposta como JSON array. Cada item: {"name": string, "quantity": number, "unitPrice": number (em reais), "description"?: string}. Ex.: [{"name":"Consultoria","quantity":10,"unitPrice":150,"description":"por hora"}]',
        },
      ],
      apply: (values) => {
        const setScalar = setValue as unknown as (
          name: keyof Scalars,
          value: string,
          opts: { shouldDirty: boolean; shouldTouch: boolean },
        ) => void;
        const SCALARS = new Set([
          "title",
          "clientCompany",
          "clientName",
          "clientEmail",
          "clientPhone",
          "clientAddress",
          "validUntil",
          "intro",
          "notes",
        ]);
        for (const [k, v] of Object.entries(values)) {
          if (k === "items") {
            try {
              const arr = JSON.parse(v);
              if (Array.isArray(arr)) {
                setItems(
                  arr.map((raw) => {
                    const o = raw as Record<string, unknown>;
                    return {
                      key: `row-${seq.current++}`,
                      rev: 1,
                      productServiceId: "",
                      name: String(o.name ?? ""),
                      description: String(o.description ?? ""),
                      quantity: Number(o.quantity) || 1,
                      unitPrice: Number(o.unitPrice) || 0,
                    };
                  }),
                );
              }
            } catch {
              /* ignore malformed JSON */
            }
          } else if (SCALARS.has(k)) {
            setScalar(k as keyof Scalars, v, { shouldDirty: true, shouldTouch: true });
          }
        }
      },
    }),
    [id, setValue],
  );
  useRegisterAssistantForm(bridge);

  const productById = useMemo(() => new Map(options.products.map((p) => [p.id, p])), [options.products]);

  const subtotal = useMemo(
    () => items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0),
    [items],
  );
  const clampedDiscount = Math.min(discount, subtotal);
  const total = Math.max(0, subtotal - clampedDiscount);

  function patchItem(key: string, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      { key: newKey(), rev: 0, productServiceId: "", name: "", description: "", quantity: 1, unitPrice: 0 },
    ]);
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  function pickProduct(key: string, productId: string) {
    const p = productId ? productById.get(productId) : null;
    setItems((prev) =>
      prev.map((it) =>
        it.key === key
          ? {
              ...it,
              productServiceId: productId,
              name: p ? p.name : it.name,
              unitPrice: p && p.price != null ? p.price : it.unitPrice,
              rev: it.rev + 1, // re-seed the money input with the catalog price
            }
          : it,
      ),
    );
  }

  async function onSubmit(values: Scalars) {
    setServerError(null);
    const payload = {
      title: values.title.trim(),
      opportunityId: defaults.opportunityId,
      companyId: values.companyId,
      contactId: values.contactId,
      clientCompany: values.clientCompany,
      clientName: values.clientName,
      clientEmail: values.clientEmail,
      clientPhone: values.clientPhone,
      clientAddress: values.clientAddress,
      intro: values.intro,
      notes: values.notes,
      validUntil: values.validUntil,
      discount,
      items: items
        .filter((it) => it.name.trim())
        .map((it) => ({
          productServiceId: it.productServiceId,
          name: it.name.trim(),
          description: it.description,
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
        })),
    };

    const result = isEdit
      ? await updateProposal(id!, { ...payload, status: values.status })
      : await createProposal(payload);

    if (result.ok) {
      router.push(`/app/proposals/${result.id}`);
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      {/* Client + title */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionClient")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="title">{t("form.title")}</Label>
            <Input id="title" aria-invalid={Boolean(errors.title)} {...register("title", { required: tv("required") })} />
            {errors.title ? <p className="mt-1 text-sm text-red-500">{errors.title.message}</p> : null}
          </div>
          <div>
            <Label htmlFor="companyId">{t("form.company")}</Label>
            <select id="companyId" className={selectCls} {...register("companyId")}>
              <option value="">{t("none")}</option>
              {options.companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="contactId">{t("form.contact")}</Label>
            <select id="contactId" className={selectCls} {...register("contactId")}>
              <option value="">{t("none")}</option>
              {options.contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="clientCompany">{t("form.clientCompany")}</Label>
            <Input id="clientCompany" {...register("clientCompany")} />
          </div>
          <div>
            <Label htmlFor="clientName">{t("form.clientName")}</Label>
            <Input id="clientName" {...register("clientName")} />
          </div>
          <div>
            <Label htmlFor="clientEmail">{t("form.clientEmail")}</Label>
            <Input id="clientEmail" type="email" {...register("clientEmail")} />
          </div>
          <div>
            <Label htmlFor="clientPhone">{t("form.clientPhone")}</Label>
            <Input id="clientPhone" {...register("clientPhone")} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="clientAddress">{t("form.clientAddress")}</Label>
            <Input id="clientAddress" {...register("clientAddress")} />
          </div>
        </div>
      </fieldset>

      {/* Items */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionItems")}</legend>

        {items.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            {t("form.noItems")}
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            {items.map((it) => {
              const lineTotal = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
              return (
                <div key={it.key} className="rounded-lg border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-4">
                      <Label>{t("form.product")}</Label>
                      <select
                        className={selectCls}
                        value={it.productServiceId}
                        onChange={(e) => pickProduct(it.key, e.target.value)}
                      >
                        <option value="">{t("form.freeItem")}</option>
                        {options.products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-4">
                      <Label>{t("form.itemName")}</Label>
                      <Input value={it.name} onChange={(e) => patchItem(it.key, { name: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label>{t("form.qty")}</Label>
                      <Input
                        type="number"
                        min={0}
                        step="1"
                        value={it.quantity}
                        onChange={(e) => patchItem(it.key, { quantity: Number(e.target.value) })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label>{t("form.unitPrice")}</Label>
                      <MoneyInput
                        key={`${it.key}:${it.rev}`}
                        defaultValue={it.unitPrice}
                        onValueChange={(n) => patchItem(it.key, { unitPrice: n })}
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <input
                      className={cn(selectCls, "flex-1 py-2")}
                      placeholder={t("form.itemDesc")}
                      value={it.description}
                      onChange={(e) => patchItem(it.key, { description: e.target.value })}
                    />
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-brand">{formatBRL(lineTotal)}</span>
                    <button
                      type="button"
                      onClick={() => removeItem(it.key)}
                      aria-label={t("form.removeItem")}
                      className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={addItem}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" />
          {t("form.addItem")}
        </button>

        {/* Totals */}
        <div className="mt-5 ml-auto w-full max-w-xs">
          <div className="flex justify-between py-1 text-sm text-muted-foreground">
            <span>{t("form.subtotal")}</span>
            <span className="tabular-nums">{formatBRL(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 py-1 text-sm">
            <span className="text-muted-foreground">{t("form.discount")}</span>
            <div className="w-32">
              <MoneyInput defaultValue={defaults.discount} onValueChange={(n) => setDiscount(n)} />
            </div>
          </div>
          <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-bold text-brand">
            <span>{t("form.total")}</span>
            <span className="tabular-nums">{formatBRL(total)}</span>
          </div>
        </div>
      </fieldset>

      {/* Details */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionDetails")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {isEdit ? (
            <div>
              <Label htmlFor="status">{t("form.statusLabel")}</Label>
              <select id="status" className={selectCls} {...register("status")}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`status.${s}`)}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <Label htmlFor="validUntil">{t("form.validUntil")}</Label>
            <Input id="validUntil" type="date" {...register("validUntil")} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="intro">{t("form.intro")}</Label>
            <Textarea id="intro" rows={4} {...register("intro")} />
            <p className="mt-1 text-xs text-muted-foreground">{t("form.introHint")}</p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">{t("form.notes")}</Label>
            <Textarea id="notes" rows={3} {...register("notes")} />
            <p className="mt-1 text-xs text-muted-foreground">{t("form.notesHint")}</p>
          </div>
        </div>
      </fieldset>

      {serverError ? <p role="alert" className="text-sm text-red-500">{serverError}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("form.saving") : t("form.save")}
        </Button>
        <Link
          href={isEdit ? `/app/proposals/${id}` : "/app/proposals"}
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("form.cancel")}
        </Link>
      </div>
    </form>
  );
}
