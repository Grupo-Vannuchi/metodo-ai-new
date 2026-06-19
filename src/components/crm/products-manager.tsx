"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import {
  createProductService,
  updateProductService,
  deleteProductService,
} from "@/app/actions/product-services";
import type { ProductServiceRow } from "@/lib/queries/crm";

type Kind = "PRODUCT" | "SERVICE";
type Result = { ok: boolean; error?: string };

function buildForm(fields: { name: string; kind: Kind; price: number | null; active: boolean }): FormData {
  const fd = new FormData();
  fd.set("name", fields.name);
  fd.set("kind", fields.kind);
  if (fields.price != null) fd.set("price", String(fields.price));
  fd.set("active", fields.active ? "true" : "false");
  return fd;
}

export function ProductsManager({ items }: { items: ProductServiceRow[] }) {
  const t = useTranslations("crm.products");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("PRODUCT");
  const [price, setPrice] = useState(0);

  function run(fn: () => Promise<Result>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(t(`error.${r.error ?? "unknown"}`));
      else router.refresh();
    });
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    setPrice(0);
    run(() => createProductService(buildForm({ name: trimmed, kind, price: price || null, active: true })));
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={onCreate}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4"
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("name")}</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="h-10"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("kind")}</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="PRODUCT">{t("kindProduct")}</option>
            <option value="SERVICE">{t("kindService")}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("price")}</label>
          <MoneyInput defaultValue={0} onValueChange={setPrice} className="h-10 w-40" />
        </div>
        <Button type="submit" disabled={pending}>
          <Plus className="size-4" />
          {t("add")}
        </Button>
      </form>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t("name")}</th>
                <th className="px-4 py-3 font-medium">{t("kind")}</th>
                <th className="px-4 py-3 font-medium">{t("price")}</th>
                <th className="px-4 py-3 font-medium">{t("status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <ItemRow key={item.id} item={item} pending={pending} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  pending,
  run,
}: {
  item: ProductServiceRow;
  pending: boolean;
  run: (fn: () => Promise<Result>) => void;
}) {
  const t = useTranslations("crm.products");
  const confirm = useConfirm();
  const [name, setName] = useState(item.name);
  const [kind, setKind] = useState<Kind>(item.kind);
  const [price, setPrice] = useState<number | null>(item.price);
  const [active, setActive] = useState(item.active);

  const dirty =
    name.trim() !== item.name || kind !== item.kind || (price ?? null) !== item.price || active !== item.active;

  function onSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    run(() => updateProductService(item.id, buildForm({ name: trimmed, kind, price, active })));
  }

  async function onToggleActive() {
    const next = !active;
    setActive(next);
    run(() => updateProductService(item.id, buildForm({ name: item.name, kind: item.kind, price: item.price, active: next })));
  }

  async function onDelete() {
    if (!(await confirm({ description: t("deleteConfirm", { name: item.name }), confirmLabel: t("delete"), variant: "danger" })))
      return;
    run(() => deleteProductService(item.id));
  }

  return (
    <tr className={cn("border-b border-border last:border-0", !active && "opacity-60")}>
      <td className="px-4 py-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
      </td>
      <td className="px-4 py-3">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="PRODUCT">{t("kindProduct")}</option>
          <option value="SERVICE">{t("kindService")}</option>
        </select>
      </td>
      <td className="px-4 py-3">
        <MoneyInput
          key={item.id}
          defaultValue={price ?? 0}
          onValueChange={(n) => setPrice(n || null)}
          className="h-9 w-36"
        />
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          disabled={pending}
          onClick={onToggleActive}
          className={cn(
            "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50",
            active ? "bg-green-500/10 text-green-600 hover:bg-green-500/20" : "bg-muted text-muted-foreground hover:bg-muted/70",
          )}
        >
          {active ? t("active") : t("inactive")}
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || !dirty}
            onClick={onSave}
          >
            <Save className="size-4" />
            {pending ? t("saving") : t("save")}
          </Button>
          <button
            type="button"
            disabled={pending}
            onClick={onDelete}
            aria-label={t("delete")}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
