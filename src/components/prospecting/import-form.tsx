"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { sendLeadsToFunnel } from "@/app/actions/extractions";

export function ImportForm({
  jobId,
  pipelines,
  productServices,
}: {
  jobId: string;
  pipelines: { id: string; name: string; isDefault: boolean; stages: { id: string; name: string }[] }[];
  productServices: { id: string; name: string; kind: string; price: number | null }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const defaultPipeline = pipelines.find((p) => p.isDefault) || pipelines[0];
  const [pipelineId, setPipelineId] = useState(defaultPipeline?.id ?? "");
  const currentPipeline = pipelines.find((p) => p.id === pipelineId);
  const availableStages = currentPipeline?.stages ?? [];
  const [stageId, setStageId] = useState(availableStages[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [leadIds, setLeadIds] = useState<string[]>([]);

  useEffect(() => {
    const stored = sessionStorage.getItem("prospecting_import_leads");
    if (stored) {
      setLeadIds(JSON.parse(stored));
    } else {
      router.push(`/app/prospecting/${jobId}`);
    }
  }, [jobId, router]);

  function handlePipelineChange(newPipelineId: string) {
    setPipelineId(newPipelineId);
    const pipe = pipelines.find((p) => p.id === newPipelineId);
    if (pipe && pipe.stages.length > 0) {
      setStageId(pipe.stages[0].id);
    } else {
      setStageId("");
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (leadIds.length === 0 || !stageId) return;
    start(async () => {
      await sendLeadsToFunnel(jobId, leadIds, stageId, productId || undefined);
      sessionStorage.removeItem("prospecting_import_leads");
      router.push(`/app/prospecting/${jobId}`);
      router.refresh();
    });
  }

  if (leadIds.length === 0) return null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Importar como Oportunidade</h1>
      </div>

      <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground mb-6">
          Você está importando <strong className="text-foreground">{leadIds.length}</strong> lead(s) para o seu funil de vendas. Configure o destino abaixo.
        </p>

        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium">Pipeline</label>
            <select
              value={pipelineId}
              onChange={(e) => handlePipelineChange(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
              required
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium">Estágio (Stage)</label>
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
              required
            >
              <option value="" disabled>Selecione um estágio</option>
              {availableStages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium">Produto / Serviço (Opcional)</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
            >
              <option value="">Nenhum (valor zerado)</option>
              {productServices.map((ps) => (
                <option key={ps.id} value={ps.id}>
                  {ps.name} {ps.price ? `(R$ ${ps.price})` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Se atrelar um produto, os cards nascerão no funil com este valor correspondente.
            </p>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3 border-t border-border pt-6">
          <Button type="button" variant="outline" onClick={() => router.push(`/app/prospecting/${jobId}`)}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending || !stageId}>
            {pending ? "Criando..." : "Confirmar Importação"}
          </Button>
        </div>
      </form>
    </div>
  );
}
