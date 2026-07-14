"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { usePrompt } from "@/components/ui/prompt";
import { Spinner } from "@/components/ui/spinner";
import { createCatalogItem, renameCatalogItem, deleteCatalogItem } from "@/app/actions/hr";
import type { CatalogRow } from "@/lib/queries/hr";

type Model = "department" | "jobRole";

/** CRUD list for one of the HR catalogs (departments or job roles). */
export function HrCatalog({
  model,
  title,
  hint,
  items,
}: {
  model: Model;
  title: string;
  hint: string;
  items: CatalogRow[];
}) {
  const t = useTranslations("hr");
  const router = useRouter();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const name = await prompt({ title: t("catalog.newTitle"), placeholder: t("catalog.namePlaceholder") });
    if (!name) return;
    setError(null);
    setBusy(true);
    const r = await createCatalogItem(model, { name });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(t(`error.${r.error}`));
  }

  async function rename(item: CatalogRow) {
    const name = await prompt({ title: t("catalog.renameTitle"), defaultValue: item.name });
    if (!name || name === item.name) return;
    setError(null);
    setBusy(true);
    const r = await renameCatalogItem(model, item.id, { name });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(t(`error.${r.error}`));
  }

  async function remove(item: CatalogRow) {
    const ok = await confirm({
      description:
        item.employeeCount > 0
          ? t("catalog.confirmDeleteInUse", { name: item.name, count: item.employeeCount })
          : t("catalog.confirmDelete", { name: item.name }),
      confirmLabel: t("delete"),
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    const r = await deleteCatalogItem(model, item.id);
    setBusy(false);
    if (r.ok) router.refresh();
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Spinner className="size-3.5" /> : <Plus className="size-3.5" />}
          {t("catalog.add")}
        </button>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">{hint}</p>

      {error ? <p role="alert" className="mb-3 text-sm text-red-500">{error}</p> : null}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {t("catalog.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {t("catalog.employeeCount", { count: item.employeeCount })}
              </span>
              <button
                type="button"
                onClick={() => void rename(item)}
                title={t("edit")}
                aria-label={t("edit")}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void remove(item)}
                title={t("delete")}
                aria-label={t("delete")}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
