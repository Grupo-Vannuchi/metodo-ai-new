"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { importLeads } from "@/app/actions/extractions";

export type LeadRow = {
  id: string;
  name: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  importedAt: Date | null;
};

export function ImportLeads({
  jobId,
  leads,
}: {
  jobId: string;
  leads: LeadRow[];
}) {
  const t = useTranslations("prospecting");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const importable = leads.filter((l) => !l.importedAt);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === importable.length
        ? new Set()
        : new Set(importable.map((l) => l.id)),
    );
  }

  function runImport() {
    if (selected.size === 0) return;
    start(async () => {
      await importLeads(jobId, [...selected]);
      setSelected(new Set());
      router.refresh();
    });
  }

  if (leads.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
        {t("noLeads")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("selectedCount", { count: selected.size })}
        </p>
        <Button type="button" onClick={runImport} disabled={pending || selected.size === 0}>
          <Download className="size-4" />
          {pending ? t("importing") : t("importSelected")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  className="size-4 accent-brand"
                  checked={importable.length > 0 && selected.size === importable.length}
                  onChange={toggleAll}
                  aria-label={t("selectAll")}
                />
              </th>
              <th className="px-4 py-3 font-medium">{t("colName")}</th>
              <th className="px-4 py-3 font-medium">{t("colCnpj")}</th>
              <th className="px-4 py-3 font-medium">{t("colPhone")}</th>
              <th className="px-4 py-3 font-medium">{t("colEmail")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    disabled={Boolean(l.importedAt)}
                    checked={selected.has(l.id)}
                    onChange={() => toggle(l.id)}
                    aria-label={l.name ?? l.id}
                  />
                </td>
                <td className="px-4 py-3 font-medium">{l.name ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.cnpj ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.phone ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.email ?? "—"}</td>
                <td className="px-4 py-3">
                  {l.importedAt ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600">
                      <Check className="size-3.5" />
                      {t("imported")}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
