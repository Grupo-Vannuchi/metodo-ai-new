"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Instagram, Facebook, Linkedin } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { importLeads, sendLeadsToFunnel } from "@/app/actions/extractions";

export type LeadRow = {
  id: string;
  name: string | null;
  segment: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  importedAt: Date | null;
};

export function ImportLeads({
  jobId,
  leads,
  stages,
}: {
  jobId: string;
  leads: LeadRow[];
  stages: { id: string; name: string }[];
}) {
  const t = useTranslations("prospecting");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [pending, start] = useTransition();

  const importable = leads.filter((l) => !l.importedAt);
  const allSelected = importable.length > 0 && importable.every((l) => selected.has(l.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(importable.map((l) => l.id)));
  }

  function onImport() {
    if (selected.size === 0) return;
    const ids = [...selected];
    start(async () => {
      await importLeads(jobId, ids);
      setSelected(new Set());
      router.refresh();
    });
  }

  function onFunnel() {
    if (selected.size === 0 || !stageId) return;
    const ids = [...selected];
    start(async () => {
      await sendLeadsToFunnel(jobId, ids, stageId);
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="size-4 accent-brand" checked={allSelected} onChange={toggleAll} disabled={importable.length === 0} />
          {t("selectAll")}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onImport} disabled={pending || selected.size === 0}>
            {pending ? t("importing") : t("importSelected", { count: selected.size })}
          </Button>
          {stages.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                aria-label={t("funnelStage")}
                className="h-9 max-w-40 rounded-lg border border-border bg-card px-2.5 text-sm focus-visible:border-brand focus-visible:outline-none"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <Button type="button" size="sm" onClick={onFunnel} disabled={pending || selected.size === 0}>
                {pending ? t("sending") : t("sendToFunnel", { count: selected.size })}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="w-10 px-4 py-3" />
              <th className="px-4 py-3 font-medium">{t("colName")}</th>
              <th className="px-4 py-3 font-medium">{t("colPhone")}</th>
              <th className="px-4 py-3 font-medium">{t("colEmail")}</th>
              <th className="px-4 py-3 font-medium">{t("colLinks")}</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const imported = Boolean(l.importedAt);
              return (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    {imported ? (
                      <Check className="size-4 text-green-600" aria-label={t("imported")} />
                    ) : (
                      <input type="checkbox" className="size-4 accent-brand" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{l.name ?? "—"}</p>
                    {l.segment ? <p className="text-xs text-muted-foreground">{l.segment}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{l.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {l.website ? (
                        <a href={l.website} target="_blank" rel="noopener noreferrer" className="hover:text-foreground" aria-label="Site">
                          <ExternalLink className="size-4" />
                        </a>
                      ) : null}
                      {l.instagram ? (
                        <a href={l.instagram} target="_blank" rel="noopener noreferrer" className="hover:text-foreground" aria-label="Instagram">
                          <Instagram className="size-4" />
                        </a>
                      ) : null}
                      {l.facebook ? (
                        <a href={l.facebook} target="_blank" rel="noopener noreferrer" className="hover:text-foreground" aria-label="Facebook">
                          <Facebook className="size-4" />
                        </a>
                      ) : null}
                      {l.linkedin ? (
                        <a href={l.linkedin} target="_blank" rel="noopener noreferrer" className="hover:text-foreground" aria-label="LinkedIn">
                          <Linkedin className="size-4" />
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
