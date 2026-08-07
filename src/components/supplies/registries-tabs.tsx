"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Trash2, Plus, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { useNotify } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { saveRegistry, deleteRegistry } from "@/app/actions/registries";
import type { RegistryRow } from "@/lib/queries/registries";

type Kind = "category" | "unit" | "warehouse";
type Data = { categories: RegistryRow[]; units: RegistryRow[]; warehouses: RegistryRow[] };

const TABS: { kind: Kind; hasExtra: boolean }[] = [
  { kind: "category", hasExtra: false },
  { kind: "unit", hasExtra: true },
  { kind: "warehouse", hasExtra: true },
];

/**
 * When `activeKind` is provided (driven by the workspace sub-nav / URL), the
 * internal tab bar is hidden and only that registry is shown. Without it, the
 * component keeps its own tab bar (standalone use).
 */
export function RegistriesTabs({ data, activeKind }: { data: Data; activeKind?: Kind }) {
  const t = useTranslations("supplies.registries");
  const [tab, setTab] = useState<Kind>(activeKind ?? "category");
  const current = activeKind ?? tab;
  const rowsByKind: Record<Kind, RegistryRow[]> = {
    category: data.categories,
    unit: data.units,
    warehouse: data.warehouses,
  };
  const cfg = TABS.find((x) => x.kind === current)!;

  return (
    <div className="flex flex-col gap-4">
      {!activeKind ? (
        <div className="flex flex-wrap gap-1">
          {TABS.map((x) => (
            <button
              key={x.kind}
              type="button"
              onClick={() => setTab(x.kind)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                tab === x.kind ? "bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t(`tab.${x.kind}`)}
            </button>
          ))}
        </div>
      ) : null}
      <RegistryManager key={current} kind={current} rows={rowsByKind[current]} hasExtra={cfg.hasExtra} />
    </div>
  );
}

function RegistryManager({ kind, rows, hasExtra }: { kind: Kind; rows: RegistryRow[]; hasExtra: boolean }) {
  const t = useTranslations("supplies.registries");
  const router = useRouter();
  const notify = useNotify();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const editing = editingId ? rows.find((r) => r.id === editingId) ?? null : null;
  const formOpen = adding || editing != null;

  function close() {
    setAdding(false);
    setEditingId(null);
    setFormKey((k) => k + 1);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = { name: String(fd.get("name") ?? ""), extra: String(fd.get("extra") ?? ""), active: fd.get("active") === "on" };
    start(async () => {
      const r = await saveRegistry(kind, editing?.id ?? null, input);
      if (r.ok) {
        notify("saved");
        close();
        router.refresh();
      }
    });
  }

  async function onDelete(row: RegistryRow) {
    if (!(await confirm({ description: t("deleteConfirm", { name: row.name }), confirmLabel: t("delete"), variant: "danger" }))) return;
    start(async () => {
      await deleteRegistry(kind, row.id);
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
          <div className={cn("grid gap-3", hasExtra && "sm:grid-cols-2")}>
            <div>
              <Label htmlFor="name">{t("name")}</Label>
              <Input id="name" name="name" defaultValue={editing?.name ?? ""} required maxLength={120} />
            </div>
            {hasExtra ? (
              <div>
                <Label htmlFor="extra">{t(`extra.${kind}`)}</Label>
                <Input id="extra" name="extra" defaultValue={editing?.extra ?? ""} maxLength={120} />
              </div>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} className="size-4 accent-brand" />
            {t("active")}
          </label>
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

      {rows.length === 0 && !formOpen ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.id} className={cn("flex items-center gap-3 rounded-lg border border-border bg-card p-3", !r.active && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {r.name}
                  {r.extra ? <span className="ml-2 text-xs text-muted-foreground">{r.extra}</span> : null}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(r.id);
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
                  onClick={() => onDelete(r)}
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
