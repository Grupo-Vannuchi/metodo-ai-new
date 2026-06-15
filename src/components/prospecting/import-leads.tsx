"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Download, ExternalLink, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { importLeads } from "@/app/actions/extractions";

export type LeadRow = {
  id: string;
  name: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  socials: unknown;
  importedAt: Date | null;
};

function socialCount(socials: unknown): number {
  return Array.isArray(socials) ? socials.length : 0;
}

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

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[44rem] text-left text-sm">
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
              <th className="px-4 py-3 font-medium">{t("colSite")}</th>
              <th className="px-4 py-3 font-medium">{t("colPhone")}</th>
              <th className="px-4 py-3 font-medium">{t("colEmail")}</th>
              <th className="px-4 py-3 font-medium">{t("colSocials")}</th>
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
                <td className="max-w-[16rem] truncate px-4 py-3 font-medium">{l.name ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {l.website ? (
                    <a
                      href={l.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-brand hover:underline"
                    >
                      <ExternalLink className="size-3.5" />
                      {t("visit")}
                    </a>
                  ) : (
                    (l.cnpj ?? "—")
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{l.phone ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.email ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {socialCount(l.socials) > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Share2 className="size-3.5" />
                      {socialCount(l.socials)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
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
