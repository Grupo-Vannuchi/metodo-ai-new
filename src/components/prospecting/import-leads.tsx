"use client";

import { useState, useTransition, useEffect } from "react";
import { createPortal } from "react-dom";
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
  pipelines,
  productServices,
}: {
  jobId: string;
  leads: LeadRow[];
  pipelines: { id: string; name: string; isDefault: boolean; stages: { id: string; name: string }[] }[];
  productServices: { id: string; name: string; kind: string; price: number | null }[];
}) {
  const t = useTranslations("prospecting");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const [modalOpen, setModalOpen] = useState(false);
  const defaultPipeline = pipelines.find((p) => p.isDefault) || pipelines[0];
  const [pipelineId, setPipelineId] = useState(defaultPipeline?.id ?? "");
  const currentPipeline = pipelines.find((p) => p.id === pipelineId);
  const availableStages = currentPipeline?.stages ?? [];
  // Whenever pipeline changes, or initially, we might need to reset stageId if it doesn't match
  const [stageId, setStageId] = useState(availableStages[0]?.id ?? "");
  const [productId, setProductId] = useState("");

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [page, setPage] = useState(1);
  const pageSize = 50;
  const totalPages = Math.ceil(leads.length / pageSize);
  const visibleLeads = leads.slice((page - 1) * pageSize, page * pageSize);

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

  function onFunnel(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0 || !stageId) return;
    const ids = [...selected];
    start(async () => {
      await sendLeadsToFunnel(jobId, ids, stageId, productId || undefined);
      setSelected(new Set());
      setModalOpen(false);
      router.refresh();
    });
  }

  // Handle pipeline change to reset stage to the first of the new pipeline
  function handlePipelineChange(newPipelineId: string) {
    setPipelineId(newPipelineId);
    const pipe = pipelines.find((p) => p.id === newPipelineId);
    if (pipe && pipe.stages.length > 0) {
      setStageId(pipe.stages[0].id);
    } else {
      setStageId("");
    }
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
          {pipelines.length > 0 ? (
            <Button type="button" size="sm" onClick={() => setModalOpen(true)} disabled={pending || selected.size === 0}>
              Importar como Oportunidade
            </Button>
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
            {visibleLeads.map((l) => {
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
        
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Mostrando <span className="font-medium">{(page - 1) * pageSize + 1}</span> até{" "}
              <span className="font-medium">{Math.min(page * pageSize, leads.length)}</span> de{" "}
              <span className="font-medium">{leads.length}</span> resultados
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                Anterior
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                Próxima
              </Button>
            </div>
          </div>
        )}
      </div>

      {modalOpen && mounted ? createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button type="button" tabIndex={-1} onClick={() => setModalOpen(false)} className="absolute inset-0 cursor-default bg-black/50 motion-safe:animate-overlay-in" />
          <form onSubmit={onFunnel} className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl motion-safe:animate-dialog-in">
            <h2 className="text-lg font-semibold">Importar como Oportunidade</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {selected.size} lead(s) selecionado(s) para entrar no CRM.
            </p>

            <label className="mt-4 block text-sm font-medium">Pipeline</label>
            <select
              value={pipelineId}
              onChange={(e) => handlePipelineChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
              required
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            <label className="mt-4 block text-sm font-medium">Estágio (Stage)</label>
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
              required
            >
              <option value="" disabled>Selecione um estágio</option>
              {availableStages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <label className="mt-4 block text-sm font-medium">Produto / Serviço (Opcional)</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
            >
              <option value="">Nenhum (valor zerado)</option>
              {productServices.map((ps) => (
                <option key={ps.id} value={ps.id}>
                  {ps.name} {ps.price ? `(R$ ${ps.price})` : ""}
                </option>
              ))}
            </select>

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={pending || !stageId}>
                {pending ? "Criando..." : "Confirmar Importação"}
              </Button>
            </div>
          </form>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
