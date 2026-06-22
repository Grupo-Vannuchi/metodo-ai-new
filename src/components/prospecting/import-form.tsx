"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { formatBRL } from "@/lib/money";
import { sendLeadsToFunnel } from "@/app/actions/extractions";

export function ImportForm({
  jobId,
  leadIds,
  pipelines,
  productServices,
}: {
  jobId: string;
  leadIds: string[];
  pipelines: { id: string; name: string; isDefault: boolean; stages: { id: string; name: string }[] }[];
  productServices: { id: string; name: string; kind: string; price: number | null }[];
}) {
  const t = useTranslations("prospecting");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const defaultPipeline = pipelines.find((p) => p.isDefault) || pipelines[0];
  const [pipelineId, setPipelineId] = useState(defaultPipeline?.id ?? "");
  const availableStages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];
  const [stageId, setStageId] = useState(availableStages[0]?.id ?? "");
  const [productId, setProductId] = useState("");

  function handlePipelineChange(newPipelineId: string) {
    setPipelineId(newPipelineId);
    const pipe = pipelines.find((p) => p.id === newPipelineId);
    setStageId(pipe?.stages[0]?.id ?? "");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (leadIds.length === 0 || !stageId) return;
    setError(null);
    start(async () => {
      const res = await sendLeadsToFunnel(jobId, leadIds, stageId, productId || undefined);
      if (res.ok) {
        router.push(`/app/prospecting/${jobId}`);
        router.refresh();
      } else {
        setError(t(`error.${res.error}`));
      }
    });
  }

  const selectCls =
    "mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("importAsOpp")}</h1>

      <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="mb-6 text-sm text-muted-foreground">{t("importIntro", { count: leadIds.length })}</p>

        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium">{t("pipeline")}</label>
            <select value={pipelineId} onChange={(e) => handlePipelineChange(e.target.value)} className={selectCls} required>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium">{t("funnelStage")}</label>
            <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={selectCls} required>
              <option value="" disabled>{t("selectStage")}</option>
              {availableStages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium">{t("product")}</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={selectCls}>
              <option value="">{t("productNone")}</option>
              {productServices.map((ps) => (
                <option key={ps.id} value={ps.id}>
                  {ps.name}{ps.price ? ` (${formatBRL(ps.price)})` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-muted-foreground">{t("productHint")}</p>
          </div>
        </div>

        {error ? <p role="alert" className="mt-4 text-sm text-red-500">{error}</p> : null}

        <div className="mt-8 flex justify-end gap-3 border-t border-border pt-6">
          <Button type="button" variant="outline" onClick={() => router.push(`/app/prospecting/${jobId}`)}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={pending || !stageId}>
            {pending ? t("creating") : t("confirmImport")}
          </Button>
        </div>
      </form>
    </div>
  );
}
