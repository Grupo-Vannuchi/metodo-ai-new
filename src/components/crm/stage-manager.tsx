"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus, ChevronUp, ChevronDown, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import {
  createStage,
  updateStage,
  deleteStage,
  moveStage,
} from "@/app/actions/pipelines";

type Stage = {
  id: string;
  name: string;
  probability: number;
  oppCount: number;
};

function StageRow({
  stage,
  isFirst,
  isLast,
}: {
  stage: Stage;
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useTranslations("crm.pipelines");
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = useState(stage.name);
  const [prob, setProb] = useState(String(stage.probability));
  const [pending, start] = useTransition();

  const dirty = name !== stage.name || prob !== String(stage.probability);

  function act(fn: () => Promise<{ ok: boolean }>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col">
        <button
          type="button"
          disabled={isFirst || pending}
          onClick={() => act(() => moveStage(stage.id, "up"))}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label={t("moveUp")}
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          disabled={isLast || pending}
          onClick={() => act(() => moveStage(stage.id, "down"))}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label={t("moveDown")}
        >
          <ChevronDown className="size-4" />
        </button>
      </div>

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-0 flex-1"
      />
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          max={100}
          value={prob}
          onChange={(e) => setProb(e.target.value)}
          className="w-20"
        />
        <span className="text-sm text-muted-foreground">%</span>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || !dirty || !name.trim()}
        onClick={() => act(() => updateStage(stage.id, { name: name.trim(), probability: Number(prob || 0) }))}
      >
        <Check className="size-4" />
        {t("save")}
      </Button>

      <button
        type="button"
        disabled={pending || stage.oppCount > 0}
        title={stage.oppCount > 0 ? t("stageInUse", { n: stage.oppCount }) : undefined}
        onClick={async () => {
          if (!(await confirm({ description: t("confirmDeleteStage"), confirmLabel: t("deleteStage"), variant: "danger" }))) return;
          act(() => deleteStage(stage.id));
        }}
        className="rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-30"
        aria-label={t("deleteStage")}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

export function StageManager({
  pipelineId,
  stages,
}: {
  pipelineId: string;
  stages: Stage[];
}) {
  const t = useTranslations("crm.pipelines");
  const router = useRouter();
  const [name, setName] = useState("");
  const [prob, setProb] = useState("0");
  const [pending, start] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    start(async () => {
      await createStage(pipelineId, { name: name.trim(), probability: Number(prob || 0) });
      setName("");
      setProb("0");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">{t("stagesTitle")}</h2>

      <div className="flex flex-col gap-2">
        {stages.map((s, i) => (
          <StageRow
            key={s.id}
            stage={s}
            isFirst={i === 0}
            isLast={i === stages.length - 1}
          />
        ))}
      </div>

      <form onSubmit={add} className="rounded-xl border border-dashed border-border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="sname">{t("stageName")}</Label>
            <Input id="sname" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sprob">{t("probability")}</Label>
            <Input id="sprob" type="number" min={0} max={100} value={prob} onChange={(e) => setProb(e.target.value)} className="w-24" />
          </div>
          <Button type="submit" disabled={pending || !name.trim()}>
            <Plus className="size-4" />
            {t("addStage")}
          </Button>
        </div>
      </form>
    </div>
  );
}
