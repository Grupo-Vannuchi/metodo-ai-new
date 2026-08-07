"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Trash2, Plus, X, Mail, Phone, MapPin } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { useNotify } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { createSupplier, updateSupplier, deleteSupplier } from "@/app/actions/suppliers";
import type { SupplierRow } from "@/lib/queries/suppliers";

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

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      name: String(fd.get("name") ?? ""),
      tradeName: String(fd.get("tradeName") ?? ""),
      document: String(fd.get("document") ?? ""),
      email: String(fd.get("email") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      contactName: String(fd.get("contactName") ?? ""),
      city: String(fd.get("city") ?? ""),
      uf: String(fd.get("uf") ?? ""),
      notes: String(fd.get("notes") ?? ""),
      active: fd.get("active") === "on",
    };
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
        <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="name">{t("name")}</Label>
              <Input id="name" name="name" defaultValue={editing?.name ?? ""} required maxLength={160} />
            </div>
            <div>
              <Label htmlFor="tradeName">{t("tradeName")}</Label>
              <Input id="tradeName" name="tradeName" defaultValue={editing?.tradeName ?? ""} maxLength={160} />
            </div>
            <div>
              <Label htmlFor="document">{t("document")}</Label>
              <Input id="document" name="document" defaultValue={editing?.document ?? ""} maxLength={32} />
            </div>
            <div>
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" name="email" type="email" defaultValue={editing?.email ?? ""} maxLength={160} />
            </div>
            <div>
              <Label htmlFor="phone">{t("phone")}</Label>
              <Input id="phone" name="phone" defaultValue={editing?.phone ?? ""} maxLength={40} />
            </div>
            <div>
              <Label htmlFor="contactName">{t("contactName")}</Label>
              <Input id="contactName" name="contactName" defaultValue={editing?.contactName ?? ""} maxLength={120} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label htmlFor="city">{t("city")}</Label>
                <Input id="city" name="city" defaultValue={editing?.city ?? ""} maxLength={80} />
              </div>
              <div>
                <Label htmlFor="uf">{t("uf")}</Label>
                <Input id="uf" name="uf" defaultValue={editing?.uf ?? ""} maxLength={2} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes">{t("notes")}</Label>
              <Textarea id="notes" name="notes" rows={2} defaultValue={editing?.notes ?? ""} maxLength={2000} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} className="size-4 accent-brand" />
              {t("active")}
            </label>
          </div>

          {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
            <button type="button" onClick={close} className="inline-flex items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground">
              <X className="size-4" />
              {t("cancel")}
            </button>
          </div>
        </form>
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
