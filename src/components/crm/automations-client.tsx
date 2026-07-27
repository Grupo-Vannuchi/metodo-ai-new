"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Pencil, Zap, X, CheckSquare, Bell, MessageCircle, ArrowDown } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import {
  TRIGGERS,
  ACTION_TYPES,
  triggerNeedsStage,
  type RuleAction,
  type TriggerType,
  type ActionType,
} from "@/lib/automation/types";
import type { AutomationRuleView } from "@/lib/queries/automations";
import { createRule, updateRule, deleteRule, toggleRule } from "@/app/actions/automations";

type Stage = { id: string; name: string; pipeline: string };
type Template = { id: string; name: string };
type Draft = { id: string | null; name: string; trigger: TriggerType; triggerStageId: string; actions: RuleAction[] };

const emptyDraft = (): Draft => ({ id: null, name: "", trigger: "stage_entered", triggerStageId: "", actions: [] });

const ACTION_ICON: Record<ActionType, typeof CheckSquare> = {
  create_task: CheckSquare,
  notify_owner: Bell,
  send_whatsapp: MessageCircle,
};

/** A connected node in the flow (n8n-style). */
function Node({
  tone,
  icon: Icon,
  label,
  children,
  onRemove,
  removeLabel,
}: {
  tone: string;
  icon: typeof Zap;
  label: string;
  children?: React.ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <div className="relative w-full max-w-md rounded-xl border border-border bg-card shadow-sm">
      <div className={cn("flex items-center gap-2 rounded-t-xl px-3 py-2", tone)}>
        <Icon className="size-4" />
        <span className="text-sm font-semibold">{label}</span>
        {onRemove ? (
          <button type="button" onClick={onRemove} aria-label={removeLabel} className="ml-auto rounded-md p-0.5 hover:bg-black/10">
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {children ? <div className="p-3">{children}</div> : null}
    </div>
  );
}

/** The little wire between two nodes. */
function Connector() {
  return (
    <div className="flex flex-col items-center py-1" aria-hidden>
      <div className="h-4 w-px bg-border" />
      <ArrowDown className="size-3.5 text-muted-foreground" />
      <div className="h-1 w-px bg-border" />
    </div>
  );
}

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

  function actionSummary(a: RuleAction) {
    if (a.type === "create_task") return t("action.create_task") + (a.title ? `: ${a.title}` : "");
    if (a.type === "notify_owner") return t("action.notify_owner");
    return `${t("action.send_whatsapp")}: ${templateName(a.templateId)}`;
  }

  function edit(rule: AutomationRuleView) {
    setError(null);
    setDraft({ id: rule.id, name: rule.name, trigger: rule.trigger, triggerStageId: rule.triggerStageId ?? "", actions: rule.actions });
  }

  function patchAction(i: number, next: RuleAction) {
    setDraft((d) => (d ? { ...d, actions: d.actions.map((x, j) => (j === i ? next : x)) } : d));
  }

  function addAction(type: ActionType) {
    setDraft((d) => {
      if (!d) return d;
      const a: RuleAction =
        type === "create_task" ? { type, title: "" } : type === "notify_owner" ? { type } : { type, templateId: templates[0]?.id ?? "" };
      return { ...d, actions: [...d.actions, a] };
    });
  }

  function save() {
    if (!draft) return;
    setError(null);
    if (!draft.name.trim() || draft.actions.length === 0) return setError(t("err.invalid"));
    if (triggerNeedsStage(draft.trigger) && !draft.triggerStageId) return setError(t("err.invalid"));
    const payload = { name: draft.name, trigger: draft.trigger, triggerStageId: draft.triggerStageId, actions: draft.actions };
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

  const toggle = (id: string, enabled: boolean) =>
    start(async () => {
      await toggleRule(id, enabled);
      router.refresh();
    });

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

      {/* Editor: a vertical flow of connected blocks (n8n style). */}
      {draft ? (
        <div className="rounded-2xl border border-brand/40 bg-brand/5 p-4">
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t("namePlaceholder")}
            className="mb-4 font-medium"
          />

          <div className="flex flex-col items-center">
            {/* Trigger node */}
            <Node tone="bg-brand/10 text-brand" icon={Zap} label={t("triggerLabel")}>
              <select
                value={draft.trigger}
                onChange={(e) => setDraft({ ...draft, trigger: e.target.value as TriggerType })}
                className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
              >
                {TRIGGERS.map((tr) => (
                  <option key={tr} value={tr}>{t(`trigger.${tr}`)}</option>
                ))}
              </select>
              {triggerNeedsStage(draft.trigger) ? (
                <select
                  value={draft.triggerStageId}
                  onChange={(e) => setDraft({ ...draft, triggerStageId: e.target.value })}
                  className="mt-2 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
                >
                  <option value="">{t("chooseStage")}</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.pipeline} · {s.name}</option>
                  ))}
                </select>
              ) : null}
            </Node>

            {/* Action nodes */}
            {draft.actions.map((a, i) => (
              <div key={i} className="flex w-full flex-col items-center">
                <Connector />
                <Node
                  tone="bg-muted text-foreground"
                  icon={ACTION_ICON[a.type]}
                  label={t(`action.${a.type}`)}
                  onRemove={() => setDraft({ ...draft, actions: draft.actions.filter((_, j) => j !== i) })}
                  removeLabel={t("removeAction")}
                >
                  {a.type === "create_task" ? (
                    <Input value={a.title} onChange={(e) => patchAction(i, { ...a, title: e.target.value })} placeholder={t("taskTitlePlaceholder")} className="h-9" />
                  ) : null}
                  {a.type === "send_whatsapp" ? (
                    <select
                      value={a.templateId}
                      onChange={(e) => patchAction(i, { ...a, templateId: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
                    >
                      {templates.length === 0 ? <option value="">{t("noTemplates")}</option> : null}
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                      ))}
                    </select>
                  ) : null}
                  {a.type === "notify_owner" ? <p className="text-xs text-muted-foreground">{t("action.notify_owner")}</p> : null}
                </Node>
              </div>
            ))}

            {/* Add-step */}
            <Connector />
            <div className="flex flex-wrap justify-center gap-2">
              {ACTION_TYPES.map((type) => {
                const Icon = ACTION_ICON[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addAction(type)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
                  >
                    <Icon className="size-3.5" />
                    {t(`action.${type}`)}
                  </button>
                );
              })}
            </div>
          </div>

          {error ? <p className="mt-4 text-center text-sm text-red-500">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)} disabled={pending}>{t("cancel")}</Button>
            <Button type="button" size="sm" onClick={save} disabled={pending}>{t("save")}</Button>
          </div>
        </div>
      ) : null}

      {/* Rule list — each rule as a compact left-to-right flow. */}
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
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-md bg-brand/10 px-2 py-0.5 font-medium text-brand">
                      {t(`trigger.${rule.trigger}`)}
                      {triggerNeedsStage(rule.trigger) ? ` · ${stageName(rule.triggerStageId)}` : ""}
                    </span>
                    {rule.actions.map((a, i) => (
                      <span key={i} className="flex items-center gap-1.5 text-muted-foreground">
                        <ArrowDown className="size-3 -rotate-90" />
                        <span className="rounded-md bg-muted px-2 py-0.5">{actionSummary(a)}</span>
                      </span>
                    ))}
                  </div>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-1">
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
