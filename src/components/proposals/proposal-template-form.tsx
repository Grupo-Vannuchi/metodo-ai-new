"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { RichTextEditor } from "@/components/proposals/rich-text-editor";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { createProposalTemplate, updateProposalTemplate } from "@/app/actions/proposal-templates";
import type { ProposalTemplateDetail } from "@/lib/queries/proposal-templates";
import type { ProposalFormOptions } from "@/lib/queries/proposals";

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

type SectionRow = { key: string; title: string; html: string };
type ItemRow = {
  key: string;
  rev: number;
  productServiceId: string;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

export function ProposalTemplateForm({
  id,
  defaults,
  options,
}: {
  id?: string; // present = edit mode
  defaults: ProposalTemplateDetail;
  options: ProposalFormOptions;
}) {
  const t = useTranslations("proposalTemplates");
  const tv = useTranslations("validation");
  const router = useRouter();
  const isEdit = Boolean(id);

  const seq = useRef(0);
  const newKey = (p: string) => `${p}-${seq.current++}`;

  const [name, setName] = useState(defaults.name);
  const [city, setCity] = useState(defaults.document.city ?? "");
  const [headerHtml, setHeaderHtml] = useState(defaults.document.header?.html ?? "");
  const [footerHtml, setFooterHtml] = useState(defaults.document.footer?.html ?? "");
  const [validityDays, setValidityDays] = useState<string>(
    defaults.validityDays != null ? String(defaults.validityDays) : "",
  );
  const [discount, setDiscount] = useState(defaults.discount);

  const [sections, setSections] = useState<SectionRow[]>(() =>
    defaults.document.sections.map((s, i) => ({ key: `s-init-${i}`, title: s.title, html: s.html })),
  );
  const [items, setItems] = useState<ItemRow[]>(() =>
    defaults.items.map((it, i) => ({
      key: `i-init-${i}`,
      rev: 0,
      productServiceId: it.productServiceId ?? "",
      name: it.name,
      description: it.description ?? "",
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    })),
  );

  const [serverError, setServerError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const productById = new Map(options.products.map((p) => [p.id, p]));
  const subtotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  const total = Math.max(0, subtotal - Math.min(discount, subtotal));

  // ---- Sections ----
  function addSection() {
    setSections((prev) => [...prev, { key: newKey("s"), title: "", html: "" }]);
  }
  function patchSection(key: string, patch: Partial<SectionRow>) {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function removeSection(key: string) {
    setSections((prev) => prev.filter((s) => s.key !== key));
  }
  function moveSection(key: string, dir: -1 | 1) {
    setSections((prev) => {
      const i = prev.findIndex((s) => s.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  // ---- Items ----
  function addItem() {
    setItems((prev) => [
      ...prev,
      { key: newKey("i"), rev: 0, productServiceId: "", name: "", description: "", quantity: 1, unitPrice: 0 },
    ]);
  }
  function patchItem(key: string, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
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
              rev: it.rev + 1,
            }
          : it,
      ),
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    setNameError(null);
    if (!name.trim()) {
      setNameError(tv("required"));
      return;
    }

    const payload = {
      name: name.trim(),
      document: {
        city: city.trim(),
        cover: defaults.document.cover ?? { imageUrl: "", subtitle: "" },
        header: { imageUrl: defaults.document.header?.imageUrl ?? "", html: headerHtml },
        footer: { imageUrl: defaults.document.footer?.imageUrl ?? "", html: footerHtml },
        signature: defaults.document.signature ?? { imageUrl: "", html: "" },
        clientLogos: defaults.document.clientLogos ?? [],
        sections: sections
          .filter((s) => s.title.trim() || s.html.trim())
          .map((s, i) => ({ id: `sec-${i}`, title: s.title.trim(), html: s.html })),
      },
      validityDays: validityDays.trim() ? Number(validityDays) : null,
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

    setSaving(true);
    const result = isEdit
      ? await updateProposalTemplate(id!, payload)
      : await createProposalTemplate(payload);
    setSaving(false);

    if (result.ok) {
      router.push("/app/proposals/templates");
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {/* Identity */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionIdentity")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="name">{t("form.name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(nameError)}
              placeholder={t("form.namePlaceholder")}
            />
            {nameError ? <p className="mt-1 text-sm text-red-500">{nameError}</p> : null}
          </div>
          <div>
            <Label htmlFor="city">{t("form.city")}</Label>
            <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="validityDays">{t("form.validityDays")}</Label>
            <Input
              id="validityDays"
              type="number"
              min={0}
              value={validityDays}
              onChange={(e) => setValidityDays(e.target.value)}
              placeholder={t("form.validityDaysHint")}
            />
          </div>
        </div>
      </fieldset>

      {/* Document sections */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionSections")}</legend>
        <p className="mt-1 text-xs text-muted-foreground">{t("form.variablesHint")}</p>

        {sections.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            {t("form.noSections")}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {sections.map((s, idx) => (
              <div key={s.key} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => moveSection(s.key, -1)}
                      disabled={idx === 0}
                      aria-label={t("form.moveUp")}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <GripVertical className="size-4" />
                    </button>
                  </div>
                  <Input
                    value={s.title}
                    onChange={(e) => patchSection(s.key, { title: e.target.value })}
                    placeholder={t("form.sectionTitle")}
                    className="flex-1 font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => removeSection(s.key)}
                    aria-label={t("form.removeSection")}
                    className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-2">
                  <RichTextEditor
                    value={s.html}
                    onChange={(html) => patchSection(s.key, { html })}
                    placeholder={t("form.sectionBody")}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addSection}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" />
          {t("form.addSection")}
        </button>
      </fieldset>

      {/* Header / footer */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionLayout")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <Label>{t("form.header")}</Label>
            <RichTextEditor value={headerHtml} onChange={setHeaderHtml} minHeight="5rem" />
          </div>
          <div>
            <Label>{t("form.footer")}</Label>
            <RichTextEditor value={footerHtml} onChange={setFooterHtml} minHeight="5rem" />
          </div>
        </div>
      </fieldset>

      {/* Commercial defaults */}
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

      {serverError ? <p role="alert" className="text-sm text-red-500">{serverError}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? t("form.saving") : t("form.save")}
        </Button>
        <Link
          href="/app/proposals/templates"
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("form.cancel")}
        </Link>
      </div>
    </form>
  );
}
