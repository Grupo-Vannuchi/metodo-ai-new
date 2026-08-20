"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Trash2, Plus, X, Mail, Phone, MapPin, Search, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { useNotify } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { onlyDigits, formatCnpj } from "@/lib/cnpj";
import { createSupplier, updateSupplier, deleteSupplier } from "@/app/actions/suppliers";
import { lookupCnpj } from "@/app/actions/companies";
import type { SupplierRow } from "@/lib/queries/suppliers";

type SupplierFormValues = {
  name: string;
  tradeName: string;
  document: string;
  email: string;
  phone: string;
  contactName: string;
  city: string;
  uf: string;
  notes: string;
  active: boolean;
};

type CnpjState = "idle" | "loading" | "done" | "notFound" | "error";

export function SuppliersManager({ suppliers }: { suppliers: SupplierRow[] }) {
  const t = useTranslations("supplies.suppliers");
  const router = useRouter();
  const notify = useNotify();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const editing = editingId ? suppliers.find((s) => s.id === editingId) ?? null : null;
  const formOpen = adding || editing != null;

  function close() {
    setAdding(false);
    setEditingId(null);
    setError(null);
    setFormKey((k) => k + 1);
  }

  function submit(input: SupplierFormValues) {
    setError(null);
    start(async () => {
      const r = editing ? await updateSupplier(editing.id, input) : await createSupplier(input);
      if (r.ok) {
        notify("saved");
        close();
        router.refresh();
      } else {
        setError(t(`error.${r.error}`));
      }
    });
  }

  async function onDelete(s: SupplierRow) {
    if (!(await confirm({ description: t("deleteConfirm", { name: s.name }), confirmLabel: t("delete"), variant: "danger" }))) return;
    start(async () => {
      await deleteSupplier(s.id);
      notify("deleted");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        {!formOpen ? (
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t("new")}
          </Button>
        ) : null}
      </div>

      {formOpen ? (
        <SupplierForm
          key={formKey}
          editing={editing}
          pending={pending}
          error={error}
          onSubmit={submit}
          onCancel={close}
          t={t}
        />
      ) : null}

      {suppliers.length === 0 && !formOpen ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {suppliers.map((s) => (
            <li
              key={s.id}
              className={cn(
                "hover-lift flex items-start gap-3 rounded-lg border border-border bg-card p-3",
                !s.active && "opacity-60",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{s.name}</p>
                  {s.tradeName ? <span className="text-xs text-muted-foreground">({s.tradeName})</span> : null}
                  {!s.active ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{t("inactive")}</span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {s.document ? <span>{s.document}</span> : null}
                  {s.contactName ? <span>{s.contactName}</span> : null}
                  {s.email ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="size-3" />
                      {s.email}
                    </span>
                  ) : null}
                  {s.phone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3" />
                      {s.phone}
                    </span>
                  ) : null}
                  {s.city || s.uf ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {[s.city, s.uf].filter(Boolean).join(" / ")}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(s.id);
                    setAdding(false);
                    setFormKey((k) => k + 1);
                  }}
                  aria-label={t("edit")}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(s)}
                  disabled={pending}
                  aria-label={t("delete")}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Controlled supplier form (keyed remount resets it). The document field
 *  doubles as a CNPJ lookup: a valid CNPJ auto-fills the blank fields. */
function SupplierForm({
  editing,
  pending,
  error,
  onSubmit,
  onCancel,
  t,
}: {
  editing: SupplierRow | null;
  pending: boolean;
  error: string | null;
  onSubmit: (input: SupplierFormValues) => void;
  onCancel: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [f, setF] = useState<SupplierFormValues>(() => ({
    name: editing?.name ?? "",
    tradeName: editing?.tradeName ?? "",
    document: editing?.document ?? "",
    email: editing?.email ?? "",
    phone: editing?.phone ?? "",
    contactName: editing?.contactName ?? "",
    city: editing?.city ?? "",
    uf: editing?.uf ?? "",
    notes: editing?.notes ?? "",
    active: editing?.active ?? true,
  }));
  const [cnpjState, setCnpjState] = useState<CnpjState>("idle");

  const set = <K extends keyof SupplierFormValues>(k: K, v: SupplierFormValues[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  async function runCnpjLookup() {
    const digits = onlyDigits(f.document);
    if (digits.length !== 14) return;
    setCnpjState("loading");
    const r = await lookupCnpj(digits);
    if (!r.ok) {
      setCnpjState(r.error === "notFound" ? "notFound" : "error");
      return;
    }
    // Fill blanks only — never clobber what the user already typed.
    setF((prev) => ({
      ...prev,
      document: formatCnpj(digits),
      name: prev.name.trim() || r.data.legalName || r.data.name,
      tradeName: prev.tradeName.trim() || r.data.tradeName,
      email: prev.email.trim() || r.data.email,
      phone: prev.phone.trim() || r.data.phone,
      city: prev.city.trim() || r.data.city,
      uf: prev.uf.trim() || r.data.uf,
    }));
    setCnpjState("done");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="document">{t("document")}</Label>
          <div className="relative">
            <Input
              id="document"
              value={f.document}
              onChange={(e) => {
                set("document", e.target.value);
                if (cnpjState !== "idle") setCnpjState("idle");
              }}
              onBlur={() => {
                if (cnpjState === "idle") void runCnpjLookup();
              }}
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              className="pr-10"
              maxLength={32}
            />
            <button
              type="button"
              onClick={() => void runCnpjLookup()}
              disabled={cnpjState === "loading"}
              title={t("cnpjLookup")}
              aria-label={t("cnpjLookup")}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {cnpjState === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            </button>
          </div>
          {cnpjState === "done" ? (
            <p className="mt-1 text-xs text-green-600 dark:text-green-400">{t("cnpjFilled")}</p>
          ) : cnpjState === "notFound" ? (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t("cnpjNotFound")}</p>
          ) : cnpjState === "error" ? (
            <p className="mt-1 text-xs text-red-500">{t("cnpjError")}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{t("cnpjHint")}</p>
          )}
        </div>
        <div>
          <Label htmlFor="name">{t("name")}</Label>
          <Input id="name" value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={160} />
        </div>
        <div>
          <Label htmlFor="tradeName">{t("tradeName")}</Label>
          <Input id="tradeName" value={f.tradeName} onChange={(e) => set("tradeName", e.target.value)} maxLength={160} />
        </div>
        <div>
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={160} />
        </div>
        <div>
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" value={f.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} />
        </div>
        <div>
          <Label htmlFor="contactName">{t("contactName")}</Label>
          <Input id="contactName" value={f.contactName} onChange={(e) => set("contactName", e.target.value)} maxLength={120} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Label htmlFor="city">{t("city")}</Label>
            <Input id="city" value={f.city} onChange={(e) => set("city", e.target.value)} maxLength={80} />
          </div>
          <div>
            <Label htmlFor="uf">{t("uf")}</Label>
            <Input id="uf" value={f.uf} onChange={(e) => set("uf", e.target.value.toUpperCase())} maxLength={2} className="uppercase" />
          </div>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes">{t("notes")}</Label>
          <Textarea id="notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => set("active", e.target.checked)}
            className="size-4 accent-brand"
          />
          {t("active")}
        </label>
      </div>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground">
          <X className="size-4" />
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
