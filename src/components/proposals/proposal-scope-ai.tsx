"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { generateProposalScope } from "@/app/actions/proposal-ai";

/** What the form has now, read when the person asks (the instruction is typed here). */
export type ScopeFormSnapshot = {
  title: string;
  clientCompany: string;
  clientName: string;
  items: { name: string; description: string; quantity: number }[];
  opportunityId: string;
  current: string;
};

/**
 * "Gerar escopo com IA", under the proposal's "Introdução" field. Shown only where the server said the AI is available (the
 * module and the key). The text comes back for review: "Usar este texto" puts it in the field, which is saved with the rest
 * of the form; nothing is saved here.
 */
export function ProposalScopeAi({
  collect,
  onUse,
}: {
  collect: () => ScopeFormSnapshot;
  onUse: (text: string) => void;
}) {
  const t = useTranslations("proposals.form.ai");
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [useCurrent, setUseCurrent] = useState(true);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Read when the panel opens and on each generation: whether the field already has text to rewrite.
  const [hasCurrent, setHasCurrent] = useState(false);

  function openPanel() {
    setHasCurrent(collect().current.trim().length > 0);
    setOpen(true);
  }

  function generate() {
    setError(null);
    const snapshot = collect();
    setHasCurrent(snapshot.current.trim().length > 0);
    start(async () => {
      const res = await generateProposalScope({
        ...snapshot,
        current: useCurrent ? snapshot.current : "",
        instruction,
      });
      if (res.ok) setDraft(res.text);
      else setError(t(`error.${res.error}`));
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={openPanel}>
        <Sparkles className="size-4" />
        {t("button")}
      </Button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand/5 p-3">
      <div>
        <Label htmlFor="scope-ai-instruction">{t("instructionLabel")}</Label>
        <Textarea
          id="scope-ai-instruction"
          rows={2}
          maxLength={1000}
          value={instruction}
          disabled={pending}
          placeholder={t("instructionPlaceholder")}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("uses")}</p>
      </div>
      {hasCurrent ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand"
            checked={useCurrent}
            disabled={pending}
            onChange={(e) => setUseCurrent(e.target.checked)}
          />
          {t("useCurrent")}
        </label>
      ) : null}

      {draft !== null ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="whitespace-pre-wrap text-sm">{draft}</p>
          <p className="mt-2 text-xs text-muted-foreground">{t("review")}</p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {draft !== null ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => {
              onUse(draft);
              setDraft(null);
              setOpen(false);
            }}
          >
            {t("use")}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant={draft !== null ? "outline" : "primary"} disabled={pending} onClick={generate}>
          <Sparkles className="size-4" />
          {pending ? t("generating") : draft !== null ? t("regenerate") : t("generate")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setDraft(null);
            setError(null);
            setOpen(false);
          }}
        >
          {t("discard")}
        </Button>
      </div>
    </div>
  );
}
