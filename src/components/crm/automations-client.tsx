"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Pencil, Zap, X, GripVertical } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import { TRIGGERS, ACTION_TYPES, type RuleAction, type TriggerType, type ActionType } from "@/lib/automation/types";
import type { AutomationRuleView } from "@/lib/queries/automations";
import { createRule, updateRule, deleteRule, toggleRule } from "@/app/actions/automations";

type Stage = { id: string; name: string; pipeline: string };
type Template = { id: string; name: string };

type Draft = {
  id: string | null;
  name: string;
  trigger: TriggerType;
  triggerStageId: string;
  actions: RuleAction[];
};

const emptyDraft = (): Draft => ({ id: null, name: "", trigger: "stage_entered", triggerStageId: "", actions: [] });

export function AutomationsClient({
  rules,
  stages,
  templates,
  canEdit,
}: {
  rules: AutomationRuleView[];
  stages: Stage[];
  templates: Template[];
  canEdit: boolean;
}) {
  const t = useTranslations("crm.automations");
  const router = useRouter();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const stageName = (id: string | null) => stages.find((s) => s.id === id)?.name ?? "—";
  const templateName = (id: string) => templates.find((x) => x.id === id)?.name ?? id;

  function describeAction(a: RuleAction) {
    if (a.type === "create_task") return t("action.create_task") + (a.title ? `: ${a.title}` : "");
    if (a.type === "notify_owner") return t("action.notify_owner");
    return `${t("action.send_whatsapp")}: ${templateName(a.templateId)}`;
  }

  function edit(rule: AutomationRuleView) {
    setError(null);
    setDraft({
      id: rule.id,
      name: rule.name,
      trigger: rule.trigger,
      triggerStageId: rule.triggerStageId ?? "",
      actions: rule.actions,
    });
  }

  function addAction(type: ActionType) {
    setDraft((d) => {
      if (!d) return d;
      const a: RuleAction =
        type === "create_task"
          ? { type, title: "" }
          : type === "notify_owner"
            ? { type }
            : { type, templateId: templates[0]?.id ?? "" };
      return { ...d, actions: [...d.actions, a] };
    });
  }

  function save() {
    if (!draft) return;
    setError(null);
    // Guard the obvious client-side gaps for a clearer message.
    if (!draft.name.trim() || draft.actions.length === 0) return setError(t("err.invalid"));
    if (draft.trigger === "stage_entered" && !draft.triggerStageId) return setError(t("err.invalid"));
    const payload = {
      name: draft.name,
      trigger: draft.trigger,
      triggerStageId: draft.triggerStageId,
      actions: draft.actions,
    };
    start(async () => {
      const r = draft.id ? await updateRule(draft.id, payload) : await createRule(payload);
      if (r.ok) {
        setDraft(null);
        router.refresh();
      } else {
        setError(t(`err.${r.error}`));
      }
    });
  }

  function remove(id: string) {
    confirm({ description: t("confirmDelete"), confirmLabel: t("delete"), variant: "danger" }).then((ok) => {
      if (!ok) return;
      start(async () => {
        await deleteRule(id);
        router.refresh();
      });
    });
  }

  function toggle(id: string, enabled: boolean) {
    start(async () => {
      await toggleRule(id, enabled);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => { setError(null); setDraft(emptyDraft()); }} disabled={!!draft}>
            <Plus className="size-4" />
            {t("newRule")}
          </Button>
        </div>
      ) : null}

      {/* Editor */}
      {draft ? (
        <div className="rounded-xl border border-brand/40 bg-brand/5 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">{t("name")}</span>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("namePlaceholder")} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">{t("when")}</span>
              <select
                value={draft.trigger}
                onChange={(e) => setDraft({ ...draft, trigger: e.target.value as TriggerType })}
                className="h-10 rounded-lg border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
              >
                {TRIGGERS.map((tr) => (
                  <option key={tr} value={tr}>{t(`trigger.${tr}`)}</option>
                ))}
              </select>
            </label>
            {draft.trigger === "stage_entered" ? (
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">{t("stage")}</span>
                <select
                  value={draft.triggerStageId}
                  onChange={(e) => setDraft({ ...draft, triggerStageId: e.target.value })}
                  className="h-10 rounded-lg border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
                >
                  <option value="">{t("chooseStage")}</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.pipeline} · {s.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {/* Actions */}
          <p className="mt-4 text-xs font-medium text-muted-foreground">{t("then")}</p>
          <div className="mt-2 flex flex-col gap-2">
            {draft.actions.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-2">
                <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                <span className="shrink-0 text-sm font-medium">{t(`action.${a.type}`)}</span>
                {a.type === "create_task" ? (
                  <Input
                    value={a.title}
                    onChange={(e) =>
                      setDraft({ ...draft, actions: draft.actions.map((x, j) => (j === i ? { ...a, title: e.target.value } : x)) })
                    }
                    placeholder={t("taskTitlePlaceholder")}
                    className="h-8"
                  />
                ) : null}
                {a.type === "send_whatsapp" ? (
                  <select
                    value={a.templateId}
                    onChange={(e) =>
                      setDraft({ ...draft, actions: draft.actions.map((x, j) => (j === i ? { ...a, templateId: e.target.value } : x)) })
                    }
                    className="h-8 flex-1 rounded-md border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
                  >
                    {templates.length === 0 ? <option value="">{t("noTemplates")}</option> : null}
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, j) => j !== i) })}
                  className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground hover:text-red-600"
                  aria-label={t("removeAction")}
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {ACTION_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addAction(type)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                  {t(`action.${type}`)}
                </button>
              ))}
            </div>
          </div>

          {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)} disabled={pending}>{t("cancel")}</Button>
            <Button type="button" size="sm" onClick={save} disabled={pending}>{t("save")}</Button>
          </div>
        </div>
      ) : null}

      {/* Rule list */}
      {rules.length === 0 && !draft ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <div key={rule.id} className={cn("rounded-xl border border-border bg-card p-4", !rule.enabled && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Zap className="size-4 shrink-0 text-brand" />
                    <h3 className="truncate font-medium">{rule.name}</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium">{t("when")}:</span>{" "}
                    {t(`trigger.${rule.trigger}`)}
                    {rule.trigger === "stage_entered" ? ` (${stageName(rule.triggerStageId)})` : ""}
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {rule.actions.map((a, i) => (
                      <li key={i} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{describeAction(a)}</li>
                    ))}
                  </ul>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {/* Enable toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.enabled}
                      onClick={() => toggle(rule.id, !rule.enabled)}
                      disabled={pending}
                      className={cn("relative h-5 w-9 rounded-full transition-colors", rule.enabled ? "bg-brand" : "bg-muted")}
                      aria-label={t("enabled")}
                    >
                      <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-transform", rule.enabled ? "translate-x-4" : "translate-x-0.5")} />
                    </button>
                    <button type="button" onClick={() => edit(rule)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("edit")}>
                      <Pencil className="size-4" />
                    </button>
                    <button type="button" onClick={() => remove(rule.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-red-600" aria-label={t("delete")}>
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
