"use client";

import { Label } from "@/components/ui/field";

export type PipelineOption = {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
};

/** The pipeline that holds a stage — the stage decides where the card lives. */
export function pipelineOfStage(pipelines: PipelineOption[], stageId: string) {
  return pipelines.find((p) => p.stages.some((s) => s.id === stageId));
}

/**
 * Pipeline + stage pickers for the opportunity forms. The stage is the only
 * value saved (the server derives the pipeline from it); picking another
 * pipeline jumps to its first stage. Pipelines without stages can't hold a
 * card, so they show disabled.
 */
export function PipelineStageFields({
  pipelines,
  stageId,
  onStageChange,
  pipelineLabel,
  stageLabel,
  selectClassName,
}: {
  pipelines: PipelineOption[];
  stageId: string;
  onStageChange: (stageId: string) => void;
  pipelineLabel: string;
  stageLabel: string;
  selectClassName: string;
}) {
  const current = pipelineOfStage(pipelines, stageId);

  return (
    <>
      <div>
        <Label htmlFor="pipelineId">{pipelineLabel}</Label>
        <select
          id="pipelineId"
          className={selectClassName}
          value={current?.id ?? ""}
          onChange={(e) => {
            const first = pipelines.find((p) => p.id === e.target.value)?.stages[0];
            if (first) onStageChange(first.id);
          }}
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id} disabled={p.stages.length === 0}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="stageId">{stageLabel}</Label>
        <select
          id="stageId"
          className={selectClassName}
          value={stageId}
          onChange={(e) => onStageChange(e.target.value)}
        >
          {(current?.stages ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
    </>
  );
}
