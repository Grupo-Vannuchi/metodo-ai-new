"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Bot, Sparkles } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useNotify } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { saveWhatsappAgent } from "@/app/actions/whatsapp-agent";
import { AGENT_MODELS } from "@/lib/validations/whatsapp-agent";
import type { WhatsappAgentRow } from "@/lib/queries/whatsapp-agent";

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

/** Starter prompts to spare the user the blank page — content comes from i18n. */
const PROMPT_PRESETS = ["comercial", "suporte", "agendamento"] as const;

export function WhatsappAgentConfig({
  connectionId,
  initial,
}: {
  connectionId: string;
  initial: WhatsappAgentRow | null;
}) {
  const t = useTranslations("connections.agent");
  const router = useRouter();
  const notify = useNotify();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  async function applyPreset(key: string) {
    const el = promptRef.current;
    if (!el) return;
    if (el.value.trim() && !(await confirm({ description: t("presetReplace"), confirmLabel: t("presetReplaceOk"), variant: "danger" }))) {
      return;
    }
    el.value = t(`presetBody.${key}`);
    el.focus();
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const input = {
      enabled,
      name: String(fd.get("name") ?? ""),
      prompt: String(fd.get("prompt") ?? ""),
      model: String(fd.get("model") ?? AGENT_MODELS[0]),
      handoffMinutes: String(fd.get("handoffMinutes") ?? "30"),
    };
    start(async () => {
      const res = await saveWhatsappAgent(connectionId, input);
      if (res.ok) {
        notify("saved");
        router.refresh();
      } else if (res.error === "invalid") {
        setError(t("errPrompt"));
      } else {
        setError(t("errGeneric"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Bot className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("title")}</h2>
            <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2">
          <span className={cn("text-xs font-medium", enabled ? "text-brand" : "text-muted-foreground")}>
            {enabled ? t("on") : t("off")}
          </span>
          <span className="relative inline-flex">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-brand" />
            <span className="pointer-events-none absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
          </span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ag-name">{t("name")}</Label>
          <Input id="ag-name" name="name" defaultValue={initial?.name ?? ""} maxLength={80} placeholder={t("namePlaceholder")} />
        </div>
        <div>
          <Label htmlFor="ag-model">{t("model")}</Label>
          <select id="ag-model" name="model" defaultValue={initial?.model ?? AGENT_MODELS[0]} className={selectCls}>
            {AGENT_MODELS.map((m) => (
              <option key={m} value={m}>
                {t(`modelOpt.${m}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="ag-prompt">{t("prompt")}</Label>
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs text-muted-foreground">{t("presetLabel")}</span>
          {PROMPT_PRESETS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => void applyPreset(k)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/50 hover:text-brand"
            >
              <Sparkles className="size-3.5" />
              {t(`presetName.${k}`)}
            </button>
          ))}
        </div>
        <Textarea
          ref={promptRef}
          id="ag-prompt"
          name="prompt"
          defaultValue={initial?.prompt ?? ""}
          rows={8}
          maxLength={8000}
          placeholder={t("promptPlaceholder")}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("promptHint")}</p>
      </div>

      <div className="sm:w-1/2">
        <Label htmlFor="ag-handoff">{t("handoff")}</Label>
        <Input id="ag-handoff" name="handoffMinutes" type="number" min={0} max={1440} defaultValue={initial?.handoffMinutes ?? 30} />
        <p className="mt-1 text-xs text-muted-foreground">{t("handoffHint")}</p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
