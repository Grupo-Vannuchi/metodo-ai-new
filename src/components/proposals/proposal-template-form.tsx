"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown, X, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Spinner } from "@/components/ui/spinner";
import { RichTextEditor } from "@/components/proposals/rich-text-editor";
import { TemplateImageField, uploadTemplateImage } from "@/components/proposals/template-image-field";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { PROPOSAL_VARIABLES } from "@/lib/proposals/variables";
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
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(defaults.name);
  const [city, setCity] = useState(defaults.document.city ?? "");
  const [headerHtml, setHeaderHtml] = useState(defaults.document.header?.html ?? "");
  const [footerHtml, setFooterHtml] = useState(defaults.document.footer?.html ?? "");
  const [validityDays, setValidityDays] = useState<string>(
    defaults.validityDays != null ? String(defaults.validityDays) : "",
  );
  const [discount, setDiscount] = useState(defaults.discount);

  // Document images (uploaded to blob storage; URLs stored in the document JSON).
  const [coverImageUrl, setCoverImageUrl] = useState(defaults.document.cover?.imageUrl ?? "");
  const [coverSubtitle, setCoverSubtitle] = useState(defaults.document.cover?.subtitle ?? "");
  const [headerImageUrl, setHeaderImageUrl] = useState(defaults.document.header?.imageUrl ?? "");
  const [footerImageUrl, setFooterImageUrl] = useState(defaults.document.footer?.imageUrl ?? "");
  const [signatureImageUrl, setSignatureImageUrl] = useState(defaults.document.signature?.imageUrl ?? "");
  const [signatureHtml, setSignatureHtml] = useState(defaults.document.signature?.html ?? "");
  const [clientLogos, setClientLogos] = useState<string[]>(defaults.document.clientLogos ?? []);
  const [logosBusy, setLogosBusy] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);

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
  /** Drop the dragged section onto `toKey`'s position. */
  function reorderSection(toKey: string) {
    setSections((prev) => {
      if (!dragKey || dragKey === toKey) return prev;
      const from = prev.findIndex((s) => s.key === dragKey);
      const to = prev.findIndex((s) => s.key === toKey);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  // ---- Client logos ----
  async function addLogo(file: File) {
    setLogosBusy(true);
    const url = await uploadTemplateImage(file);
    setLogosBusy(false);
    if (url) setClientLogos((prev) => [...prev, url].slice(0, 15));
  }
  function removeLogo(url: string) {
    setClientLogos((prev) => prev.filter((u) => u !== url));
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
        cover: { imageUrl: coverImageUrl, subtitle: coverSubtitle.trim() },
        header: { imageUrl: headerImageUrl, html: headerHtml },
        footer: { imageUrl: footerImageUrl, html: footerHtml },
        signature: { imageUrl: signatureImageUrl, html: signatureHtml },
        clientLogos,
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

      {/* Cover */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionCover")}</legend>
        <div className="mt-2 grid items-start gap-4 sm:grid-cols-2">
          <TemplateImageField label={t("form.coverImage")} url={coverImageUrl} onChange={setCoverImageUrl} />
          <div>
            <Label htmlFor="coverSubtitle">{t("form.coverSubtitle")}</Label>
            <Input
              id="coverSubtitle"
              value={coverSubtitle}
              onChange={(e) => setCoverSubtitle(e.target.value)}
              placeholder={t("form.coverSubtitleHint")}
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
              <div
                key={s.key}
                onDragOver={(e) => {
                  if (dragKey && dragKey !== s.key) e.preventDefault();
                }}
                onDrop={() => {
                  reorderSection(s.key);
                  setDragKey(null);
                }}
                className={cn(
                  "rounded-lg border border-border p-3 transition-colors",
                  dragKey === s.key ? "opacity-50" : "",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    draggable
                    onDragStart={() => setDragKey(s.key)}
                    onDragEnd={() => setDragKey(null)}
                    title={t("form.drag")}
                    className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                  >
                    <GripVertical className="size-4" />
                  </span>
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => moveSection(s.key, -1)}
                      disabled={idx === 0}
                      aria-label={t("form.moveUp")}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(s.key, 1)}
                      disabled={idx === sections.length - 1}
                      aria-label={t("form.moveDown")}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="size-3.5" />
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
                    variables={PROPOSAL_VARIABLES}
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
        <div className="mt-2 grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <TemplateImageField label={t("form.headerImage")} url={headerImageUrl} onChange={setHeaderImageUrl} />
            <div>
              <Label>{t("form.header")}</Label>
              <RichTextEditor value={headerHtml} onChange={setHeaderHtml} minHeight="5rem" variables={PROPOSAL_VARIABLES} />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <TemplateImageField label={t("form.footerImage")} url={footerImageUrl} onChange={setFooterImageUrl} />
            <div>
              <Label>{t("form.footer")}</Label>
              <RichTextEditor value={footerHtml} onChange={setFooterHtml} minHeight="5rem" variables={PROPOSAL_VARIABLES} />
            </div>
          </div>
        </div>
      </fieldset>

      {/* Signature & client logos */}
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{t("form.sectionSignature")}</legend>
        <div className="mt-2 grid items-start gap-4 sm:grid-cols-2">
          <TemplateImageField label={t("form.signatureImage")} url={signatureImageUrl} onChange={setSignatureImageUrl} />
          <div>
            <Label>{t("form.signature")}</Label>
            <RichTextEditor value={signatureHtml} onChange={setSignatureHtml} minHeight="5rem" variables={PROPOSAL_VARIABLES} />
          </div>
        </div>
        <div className="mt-4">
          <Label>{t("form.clientLogos")}</Label>
          <p className="mb-1.5 text-xs text-muted-foreground">{t("form.clientLogosHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {clientLogos.map((u) => (
              <div key={u} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="h-12 w-auto max-w-28 rounded border border-border object-contain p-1" />
                <button
                  type="button"
                  onClick={() => removeLogo(u)}
                  aria-label={t("form.removeImage")}
                  className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card p-0.5 text-muted-foreground shadow transition-colors hover:text-red-600"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {clientLogos.length < 15 ? (
              <>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void addLogo(f);
                  }}
                />
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logosBusy}
                  aria-label={t("form.uploadImage")}
                  className="flex h-12 w-16 items-center justify-center rounded border border-dashed border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  {logosBusy ? <Spinner className="size-4" /> : <ImagePlus className="size-4" />}
                </button>
              </>
            ) : null}
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
