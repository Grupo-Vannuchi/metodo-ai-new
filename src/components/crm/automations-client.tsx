"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Plus, Trash2, Pencil, Zap, X, CheckSquare, Bell, BellPlus, MessageCircle, Mail,
  ArrowRightLeft, UserCog, CalendarClock, Tag, Wallet, Webhook, ZoomIn, ZoomOut, Maximize2,
  MessagesSquare, Briefcase, ListOrdered, CornerDownRight,
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import {
  TRIGGERS,
  ACTION_TYPES,
  WHATSAPP_ONLY_ACTIONS,
  triggerNeedsStage,
  isWhatsappTrigger,
  isFlowStep,
  ruleProblem,
  type RuleAction,
  type RuleConfig,
  type TriggerType,
  type ActionType,
  type NodePos,
  type MenuOption,
  type WhatsappStart,
  type WhatsappTriggerConfig,
} from "@/lib/automation/types";
import type { AutomationRuleView, WhatsappConnectionOption } from "@/lib/queries/automations";
import { createRule, updateRule, deleteRule, toggleRule } from "@/app/actions/automations";
import { Field, MenuInspector, OptionInspector, QuestionsEditor, Select } from "@/components/crm/automation-flow-inspectors";

type Stage = { id: string; name: string; pipeline: string };
type Template = { id: string; name: string };
type Member = { id: string; name: string };
type Layout = { trigger?: NodePos; actions?: NodePos[]; branches?: NodePos[] };
type Draft = {
  id: string | null;
  name: string;
  trigger: TriggerType;
  triggerStageId: string;
  minValue: string;
  maxValue: string;
  actions: RuleAction[];
  layout: Layout;
  wa: WhatsappTriggerConfig;
};
/** A canvas node: the trigger, an action index, or a menu option's node. */
type NodeKey = "trigger" | number | { branch: number };
type Selection = NodeKey | null;

const NODE_W = 216;
const GAP = 24;
const ROW = 130;
const gridPos = (i: number): NodePos => ({ x: 24 + ((i + 1) % 3) * (NODE_W + GAP), y: 24 + Math.floor((i + 1) / 3 + 1) * ROW });
const menuOf = (actions: RuleAction[]) => (actions[0]?.type === "ask_menu" ? actions[0] : null);

/** Default position for a node when the saved layout has none. With a menu as
 *  the first step, its options sit in a row below it and the next steps below that. */
function defaultPos(key: NodeKey, actions: RuleAction[], layout: Layout): NodePos {
  if (key === "trigger") return { x: 24, y: 24 };
  const menu = menuOf(actions);
  if (!menu || key === 0) return typeof key === "number" ? gridPos(key) : gridPos(0);
  const at = layout.actions?.[0] ?? gridPos(0);
  if (typeof key === "object") {
    const startX = Math.max(24, at.x - ((menu.options.length - 1) / 2) * (NODE_W + GAP));
    return { x: startX + key.branch * (NODE_W + GAP), y: at.y + ROW };
  }
  return { x: at.x + ((key - 1) % 3) * (NODE_W + GAP), y: at.y + 2 * ROW + Math.floor((key - 1) / 3) * ROW };
}

/** Every node's position, saved or default, with one entry per menu option. */
function fullLayout(actions: RuleAction[], layout: Layout): Layout {
  const trigger = layout.trigger ?? defaultPos("trigger", actions, layout);
  const acts = actions.map((_, i) => layout.actions?.[i] ?? defaultPos(i, actions, layout));
  const menu = menuOf(actions);
  const branches = menu?.options.map((_, i) => layout.branches?.[i] ?? defaultPos({ branch: i }, actions, { ...layout, actions: acts }));
  return { trigger, actions: acts, ...(branches ? { branches } : {}) };
}

/** Shift all positions so the top-left node sits at (24, 24) — guarantees the
 * whole flow is visible when the editor opens, regardless of saved coords. */
function normalizeLayout(actions: RuleAction[], layout: Layout): Layout {
  const full = fullLayout(actions, layout);
  const all = [full.trigger!, ...full.actions!, ...(full.branches ?? [])];
  const dx = 24 - Math.min(...all.map((p) => p.x));
  const dy = 24 - Math.min(...all.map((p) => p.y));
  const move = (p: NodePos) => ({ x: p.x + dx, y: p.y + dy });
  return {
    trigger: move(full.trigger!),
    actions: full.actions!.map(move),
    ...(full.branches ? { branches: full.branches.map(move) } : {}),
  };
}
const emptyWa = (connectionId = ""): WhatsappTriggerConfig => ({ connectionId, start: "keyword", keyword: "", match: "contains" });
const emptyDraft = (): Draft => ({
  id: null, name: "", trigger: "stage_entered", triggerStageId: "", minValue: "", maxValue: "", actions: [], layout: {},
  wa: emptyWa(),
});
const parseMoney = (s: string) => (s ? Number(s.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".")) : undefined);

const ACTION_ICON: Record<ActionType, typeof CheckSquare> = {
  ask_questions: MessagesSquare,
  ask_menu: ListOrdered,
  create_opportunity: Briefcase,
  create_task: CheckSquare,
  notify_owner: Bell,
  notify_user: BellPlus,
  send_whatsapp: MessageCircle,
  send_email: Mail,
  move_stage: ArrowRightLeft,
  set_owner: UserCog,
  set_expected_close: CalendarClock,
  add_tag: Tag,
  create_finance_entry: Wallet,
  webhook: Webhook,
};

function newAction(type: ActionType, firstTemplate?: string, firstStage?: string, firstMember?: string): RuleAction {
  switch (type) {
    case "ask_questions": return { type, questions: [{ label: "", field: "notes" }] };
    case "ask_menu": return { type, question: "", options: [{ label: "", questions: [] }, { label: "", questions: [] }] };
    case "create_opportunity": return { type };
    case "create_task": return { type, title: "", priority: "MEDIUM" };
    case "notify_owner": return { type };
    case "notify_user": return { type, userId: firstMember ?? "" };
    case "send_whatsapp": return { type, templateId: firstTemplate ?? "" };
    case "send_email": return { type, subject: "", body: "" };
    case "move_stage": return { type, stageId: firstStage ?? "" };
    case "set_owner": return { type, userId: firstMember ?? "" };
    case "set_expected_close": return { type, inDays: 7 };
    case "add_tag": return { type, tag: "" };
    case "create_finance_entry": return { type, description: "", useOppValue: true };
    case "webhook": return { type, url: "" };
  }
}

export function AutomationsClient({
  rules,
  stages,
  templates,
  members,
  connections,
  whatsappEnabled,
  canEdit,
}: {
  rules: AutomationRuleView[];
  stages: Stage[];
  templates: Template[];
  members: Member[];
  connections: WhatsappConnectionOption[];
  whatsappEnabled: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations("crm.automations");
  const router = useRouter();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<Selection>("trigger");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomBy = (d: number) => setZoom((z) => Math.max(0.4, Math.min(1.6, Math.round((z + d) * 10) / 10)));
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const stageName = (id: string | null) => stages.find((s) => s.id === id)?.name ?? "—";
  const templateName = (id: string) => templates.find((x) => x.id === id)?.name ?? id;
  const memberName = (id: string) => members.find((x) => x.id === id)?.name ?? id;

  const waSummary = (wa: WhatsappTriggerConfig) =>
    wa.start === "any" ? ` · ${t("waStartAnyShort")}` : wa.keyword ? ` · "${wa.keyword}"` : "";

  function actionSummary(a: RuleAction): string {
    switch (a.type) {
      case "ask_questions": return `${t("action.ask_questions")}: ${t("questionsCount", { count: a.questions.length })}`;
      case "ask_menu": return `${t("action.ask_menu")}: ${t("optionsCount", { count: a.options.length })}`;
      case "create_opportunity": return t("action.create_opportunity");
      case "create_task": return t("action.create_task") + (a.title ? `: ${a.title}` : "");
      case "notify_owner": return t("action.notify_owner");
      case "notify_user": return `${t("action.notify_user")}: ${memberName(a.userId)}`;
      case "send_whatsapp": return `${t("action.send_whatsapp")}: ${templateName(a.templateId)}`;
      case "send_email": return `${t("action.send_email")}: ${a.subject || "—"}`;
      case "move_stage": return `${t("action.move_stage")}: ${stageName(a.stageId)}`;
      case "set_owner": return `${t("action.set_owner")}: ${memberName(a.userId)}`;
      case "set_expected_close": return `${t("action.set_expected_close")}: +${a.inDays}d`;
      case "add_tag": return `${t("action.add_tag")}: ${a.tag || "—"}`;
      case "create_finance_entry": return t("action.create_finance_entry");
      case "webhook": return `${t("action.webhook")}`;
    }
  }

  // ── Draft helpers ──────────────────────────────────────────────────────────
  function open(rule?: AutomationRuleView) {
    setError(null);
    setSelected("trigger");
    resetView();
    if (rule) {
      setDraft({
        id: rule.id,
        name: rule.name,
        trigger: rule.trigger,
        triggerStageId: rule.triggerStageId ?? "",
        minValue: rule.config.minValue ? String(rule.config.minValue) : "",
        maxValue: rule.config.maxValue ? String(rule.config.maxValue) : "",
        actions: rule.actions,
        layout: normalizeLayout(rule.actions, rule.config.layout ?? {}),
        wa: rule.config.whatsapp ?? emptyWa(),
      });
    } else {
      setDraft({ ...emptyDraft(), wa: emptyWa(connections.length === 1 ? connections[0].id : "") });
    }
  }

  /** Switching to the WhatsApp trigger puts "Fazer perguntas" first, since the
   *  flow needs a first step; the canvas layout restarts so nodes don't overlap. */
  function changeTrigger(next: TriggerType) {
    setDraft((d) => {
      if (!d) return d;
      if (!isWhatsappTrigger(next) || d.actions.some(isFlowStep)) return { ...d, trigger: next };
      return { ...d, trigger: next, actions: [newAction("ask_questions"), ...d.actions], layout: {} };
    });
  }

  const isWa = draft ? isWhatsappTrigger(draft.trigger) : false;
  const availableTriggers = TRIGGERS.filter((tr) => !isWhatsappTrigger(tr) || whatsappEnabled || draft?.trigger === tr);
  const availableActions = ACTION_TYPES.filter((type) => {
    if (!WHATSAPP_ONLY_ACTIONS.includes(type)) return true;
    if (!isWa) return false;
    // A rule has one first step: "Fazer perguntas" or "Menu de opções".
    return type === "create_opportunity" || !draft?.actions.some(isFlowStep);
  });
  const menu = draft ? menuOf(draft.actions) : null;

  function posOf(key: NodeKey): NodePos {
    if (!draft) return { x: 0, y: 0 };
    const saved =
      key === "trigger" ? draft.layout.trigger
      : typeof key === "number" ? draft.layout.actions?.[key]
      : draft.layout.branches?.[key.branch];
    return saved ?? defaultPos(key, draft.actions, draft.layout);
  }
  const isSelected = (key: NodeKey) =>
    typeof key === "object" ? typeof selected === "object" && selected?.branch === key.branch : selected === key;

  function patchAction(i: number, next: RuleAction) {
    setDraft((d) => (d ? { ...d, actions: d.actions.map((x, j) => (j === i ? next : x)) } : d));
  }

  function addAction(type: ActionType) {
    const first = type === "ask_questions" || type === "ask_menu";
    setDraft((d) => {
      if (!d) return d;
      const action = newAction(type, templates[0]?.id, stages[0]?.id, members[0]?.id);
      // The first step goes before everything else; the canvas re-lays out around it.
      if (first) return { ...d, actions: [action, ...d.actions], layout: { trigger: d.layout.trigger } };
      const idx = d.actions.length;
      const actions = [...d.actions, action];
      const layoutActions = [...(d.layout.actions ?? [])];
      layoutActions[idx] = defaultPos(idx, actions, d.layout);
      return { ...d, actions, layout: { ...d.layout, actions: layoutActions } };
    });
    setSelected(first ? 0 : draft ? draft.actions.length : null);
  }

  function removeAction(i: number) {
    setDraft((d) => {
      if (!d) return d;
      const droppedMenu = d.actions[i]?.type === "ask_menu";
      return {
        ...d,
        actions: d.actions.filter((_, j) => j !== i),
        layout: {
          ...d.layout,
          actions: (d.layout.actions ?? []).filter((_, j) => j !== i),
          branches: droppedMenu ? undefined : d.layout.branches,
        },
      };
    });
    setSelected("trigger");
  }

  // ── Menu options: each one is also a canvas node, so its position follows it ──
  function patchMenu(update: (options: MenuOption[], branches: NodePos[]) => [MenuOption[], NodePos[]]) {
    setDraft((d) => {
      const m = d ? menuOf(d.actions) : null;
      if (!d || !m) return d;
      const branches = fullLayout(d.actions, d.layout).branches ?? [];
      const [options, nextBranches] = update(m.options, branches);
      return {
        ...d,
        actions: [{ ...m, options }, ...d.actions.slice(1)],
        layout: { ...d.layout, branches: nextBranches },
      };
    });
  }
  function patchOption(i: number, next: MenuOption) {
    patchMenu((options, branches) => [options.map((o, j) => (j === i ? next : o)), branches]);
  }
  function removeOption(i: number) {
    patchMenu((options, branches) => [options.filter((_, j) => j !== i), branches.filter((_, j) => j !== i)]);
    setSelected((s) => (typeof s === "object" && s !== null ? 0 : s));
  }
  function moveOption(i: number, delta: -1 | 1) {
    const swap = <T,>(list: T[]) => {
      const j = i + delta;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    };
    patchMenu((options, branches) => [swap(options), swap(branches)]);
  }

  // ── Dragging ───────────────────────────────────────────────────────────────
  // Drag the empty canvas to pan the whole flow.
  function startPan(e: React.MouseEvent) {
    if (e.target !== e.currentTarget) return; // only the background, not a node
    setSelected(null);
    const p0 = { ...pan };
    const sx = e.clientX;
    const sy = e.clientY;
    const onMove = (ev: MouseEvent) => setPan({ x: p0.x + (ev.clientX - sx), y: p0.y + (ev.clientY - sy) });
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startDrag(key: NodeKey, e: React.MouseEvent) {
    if (!canEdit) return;
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Screen point → unscaled world coordinate (undo the pan translate + zoom).
    const toCanvas = (cx: number, cy: number) => ({
      x: (cx - rect.left - pan.x) / zoom,
      y: (cy - rect.top - pan.y) / zoom,
    });
    const start0 = posOf(key);
    const p0 = toCanvas(e.clientX, e.clientY);
    const offX = p0.x - start0.x;
    const offY = p0.y - start0.y;
    const onMove = (ev: MouseEvent) => {
      const p = toCanvas(ev.clientX, ev.clientY);
      const x = Math.max(0, p.x - offX);
      const y = Math.max(0, p.y - offY);
      setDraft((d) => {
        if (!d) return d;
        if (key === "trigger") return { ...d, layout: { ...d.layout, trigger: { x, y } } };
        if (typeof key === "object") {
          // Fill every option's position so indices stay aligned when saved.
          const arr = [...(fullLayout(d.actions, d.layout).branches ?? [])];
          arr[key.branch] = { x, y };
          return { ...d, layout: { ...d.layout, branches: arr } };
        }
        const arr = [...(d.layout.actions ?? [])];
        arr[key] = { x, y };
        return { ...d, layout: { ...d.layout, actions: arr } };
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function save() {
    if (!draft) return;
    setError(null);
    // Saved with every node's position, one per option, so indices line up on reopen.
    const layout = fullLayout(draft.actions, draft.layout);
    const config: RuleConfig = isWa
      ? { layout, whatsapp: draft.wa }
      : { minValue: parseMoney(draft.minValue), maxValue: parseMoney(draft.maxValue), layout };
    const problem = ruleProblem({ ...draft, config });
    if (problem) return setError(t(`problem.${problem}`));
    const payload = { name: draft.name, trigger: draft.trigger, triggerStageId: draft.triggerStageId, actions: draft.actions, config };
    start(async () => {
      const r = draft.id ? await updateRule(draft.id, payload) : await createRule(payload);
      if (r.ok) {
        setDraft(null);
        router.refresh();
      } else setError(t(`err.${r.error}`));
    });
  }

  function remove(id: string) {
    confirm({ description: t("confirmDelete"), confirmLabel: t("delete"), variant: "danger" }).then((ok) => {
      if (!ok) return;
      start(async () => { await deleteRule(id); router.refresh(); });
    });
  }
  const toggle = (id: string, enabled: boolean) =>
    start(async () => {
      setListError(null);
      const r = await toggleRule(id, enabled);
      if (r.error) setListError(t(`err.${r.error}`));
      router.refresh();
    });

  // Connector line between two node centers.
  const center = (key: NodeKey) => {
    const p = posOf(key);
    return { x: p.x + NODE_W / 2, y: p.y + 34 };
  };
  const link = (from: NodeKey, to: NodeKey) => {
    const a = center(from);
    const b = center(to);
    return `M ${a.x} ${a.y} C ${a.x} ${(a.y + b.y) / 2}, ${b.x} ${(a.y + b.y) / 2}, ${b.x} ${b.y}`;
  };
  // With a menu, the options sit between it and the next step instead of a direct line.
  const links: [NodeKey, NodeKey][] = draft
    ? draft.actions.flatMap((_, i): [NodeKey, NodeKey][] => {
        if (i === 0) return [["trigger", 0], ...(menu?.options.map((_, b): [NodeKey, NodeKey] => [0, { branch: b }]) ?? [])];
        if (i === 1 && menu) return menu.options.map((_, b): [NodeKey, NodeKey] => [{ branch: b }, 1]);
        return [[i - 1, i]];
      })
    : [];

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => open()} disabled={!!draft}>
            <Plus className="size-4" />
            {t("newRule")}
          </Button>
        </div>
      ) : null}

      {/* ── Canvas editor ─────────────────────────────────────────────────── */}
      {draft ? (
        <div className="glass rounded-2xl border border-border p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("namePlaceholder")} className="max-w-xs font-medium" />
            <div className="ml-auto flex items-center gap-1">
              {availableActions.map((type) => {
                const Icon = ACTION_ICON[type];
                return (
                  <button key={type} type="button" onClick={() => addAction(type)} title={t(`action.${type}`)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border bg-card px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand hover:text-foreground">
                    <Icon className="size-3.5" />
                    <Plus className="size-3" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
            {/* Canvas (relative wrapper holds the floating zoom controls). */}
            <div className="relative">
              <div
                ref={canvasRef}
                className="relative h-[26rem] cursor-grab overflow-hidden rounded-xl border border-border active:cursor-grabbing"
                onMouseDown={startPan}
                style={{
                  backgroundColor: "var(--color-card)",
                  backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)",
                  backgroundSize: `${18 * zoom}px ${18 * zoom}px`,
                  backgroundPosition: `${pan.x}px ${pan.y}px`,
                }}
              >
                {/* The panned + zoomed world. Nothing scrolls — pan/zoom instead,
                    so nodes can never get lost off a scrollbar. */}
                <div
                  className="absolute left-0 top-0"
                  style={{ width: 2400, height: 1600, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
                  onMouseDown={startPan}
                >
                  <svg width={2400} height={1600} className="pointer-events-none absolute left-0 top-0" aria-hidden>
                    {links.map(([from, to], i) => (
                      <path key={i} d={link(from, to)} fill="none" stroke="var(--color-brand)" strokeOpacity="0.5" strokeWidth="2" />
                    ))}
                  </svg>

                  <CanvasNode
                    pos={posOf("trigger")}
                    selected={isSelected("trigger")}
                    tone="bg-brand/10 text-brand"
                    icon={Zap}
                    label={t("triggerLabel")}
                    summary={
                      t(`trigger.${draft.trigger}`) +
                      (triggerNeedsStage(draft.trigger) ? ` · ${stageName(draft.triggerStageId)}` : "") +
                      (isWa ? waSummary(draft.wa) : "")
                    }
                    onSelect={() => setSelected("trigger")}
                    onDragStart={(e) => startDrag("trigger", e)}
                  />

                  {draft.actions.map((a, i) => (
                    <CanvasNode
                      key={i}
                      pos={posOf(i)}
                      selected={isSelected(i)}
                      tone="bg-muted text-foreground"
                      icon={ACTION_ICON[a.type]}
                      label={t(`action.${a.type}`)}
                      summary={actionSummary(a)}
                      onSelect={() => setSelected(i)}
                      onDragStart={(e) => startDrag(i, e)}
                      onRemove={() => removeAction(i)}
                      removeLabel={t("removeAction")}
                    />
                  ))}

                  {menu?.options.map((o, b) => (
                    <CanvasNode
                      key={`branch-${b}`}
                      pos={posOf({ branch: b })}
                      selected={isSelected({ branch: b })}
                      tone="bg-card text-foreground border-b border-dashed border-border"
                      icon={CornerDownRight}
                      label={`${b + 1} · ${o.label.trim() || t("optionTitle", { n: b + 1 })}`}
                      summary={o.questions.length ? t("questionsCount", { count: o.questions.length }) : t("optionFinalOnly")}
                      onSelect={() => setSelected({ branch: b })}
                      onDragStart={(e) => startDrag({ branch: b }, e)}
                      onRemove={() => removeOption(b)}
                      removeLabel={t("removeOption")}
                    />
                  ))}
                </div>
              </div>

              {/* Floating zoom controls (over the canvas, not scaled). */}
              <div className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur">
                <button type="button" onClick={() => zoomBy(-0.1)} aria-label={t("zoomOut")} title={t("zoomOut")} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <ZoomOut className="size-4" />
                </button>
                <button type="button" onClick={resetView} title={t("zoomReset")} className="min-w-11 px-1 text-center text-xs font-medium tabular-nums text-muted-foreground hover:text-foreground">
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" onClick={() => zoomBy(0.1)} aria-label={t("zoomIn")} title={t("zoomIn")} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <ZoomIn className="size-4" />
                </button>
                <button type="button" onClick={resetView} aria-label={t("zoomReset")} title={t("zoomReset")} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Maximize2 className="size-4" />
                </button>
              </div>
            </div>

            {/* Inspector */}
            <div className="rounded-xl border border-border bg-card p-3">
              {selected === "trigger" ? (
                <div className="flex flex-col gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("triggerLabel")}</p>
                  <Field label={t("when")}>
                    <Select value={draft.trigger} onChange={(v) => changeTrigger(v as TriggerType)} options={availableTriggers.map((tr) => ({ value: tr, label: t(`trigger.${tr}`) }))} />
                  </Field>
                  {triggerNeedsStage(draft.trigger) ? (
                    <Field label={t("stage")}>
                      <Select value={draft.triggerStageId} onChange={(v) => setDraft({ ...draft, triggerStageId: v })} placeholder={t("chooseStage")} options={stages.map((s) => ({ value: s.id, label: `${s.pipeline} · ${s.name}` }))} />
                    </Field>
                  ) : null}
                  {isWa ? (
                    <>
                      <Field label={t("waConnection")}>
                        <Select
                          value={draft.wa.connectionId}
                          onChange={(v) => setDraft({ ...draft, wa: { ...draft.wa, connectionId: v } })}
                          placeholder={t("waChooseConnection")}
                          options={connections.map((c) => ({ value: c.id, label: c.active ? c.label : `${c.label} (${t("waDisconnected")})` }))}
                        />
                      </Field>
                      {connections.length === 0 ? <p className="text-xs text-muted-foreground">{t("waNoConnections")}</p> : null}
                      <Field label={t("waStart")}>
                        <Select
                          value={draft.wa.start}
                          onChange={(v) => setDraft({ ...draft, wa: { ...draft.wa, start: (v === "any" ? "any" : "keyword") as WhatsappStart } })}
                          options={(["keyword", "any"] as const).map((s) => ({ value: s, label: t(`waStartMode.${s}`) }))}
                        />
                      </Field>
                      {draft.wa.start === "any" ? (
                        <p className="text-xs text-muted-foreground">{t("waStartAnyHint")}</p>
                      ) : (
                        <>
                          <Field label={t("waKeyword")}>
                            <Input value={draft.wa.keyword} onChange={(e) => setDraft({ ...draft, wa: { ...draft.wa, keyword: e.target.value.slice(0, 60) } })} placeholder={t("waKeywordPlaceholder")} className="h-9" />
                          </Field>
                          <Field label={t("waMatch")}>
                            <Select value={draft.wa.match} onChange={(v) => setDraft({ ...draft, wa: { ...draft.wa, match: v === "exact" ? "exact" : "contains" } })} options={(["contains", "exact"] as const).map((m) => ({ value: m, label: t(`waMatchMode.${m}`) }))} />
                          </Field>
                          <p className="text-xs text-muted-foreground">{t("waMatchHint")}</p>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <Field label={t("minValue")}>
                        <Input value={draft.minValue} onChange={(e) => setDraft({ ...draft, minValue: e.target.value })} placeholder={t("minValuePlaceholder")} inputMode="numeric" className="h-9" />
                      </Field>
                      <Field label={t("maxValue")}>
                        <Input value={draft.maxValue} onChange={(e) => setDraft({ ...draft, maxValue: e.target.value })} placeholder={t("maxValuePlaceholder")} inputMode="numeric" className="h-9" />
                      </Field>
                    </>
                  )}
                </div>
              ) : typeof selected === "number" && draft.actions[selected] ? (
                <ActionInspector
                  action={draft.actions[selected]}
                  onChange={(next) => patchAction(selected, next)}
                  onRemoveOption={removeOption}
                  onMoveOption={moveOption}
                  templates={templates}
                  stages={stages}
                  members={members}
                  t={t}
                />
              ) : typeof selected === "object" && selected && menu?.options[selected.branch] ? (
                <OptionInspector
                  index={selected.branch}
                  option={menu.options[selected.branch]}
                  onChange={(next) => patchOption(selected.branch, next)}
                  t={t}
                />
              ) : (
                <p className="py-8 text-center text-xs text-muted-foreground">{t("inspectorHint")}</p>
              )}
            </div>
          </div>

          {error ? <p className="mt-3 text-center text-sm text-red-500">{error}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)} disabled={pending}>{t("cancel")}</Button>
            <Button type="button" size="sm" onClick={save} disabled={pending}>{t("save")}</Button>
          </div>
        </div>
      ) : null}

      {/* ── Rule list ─────────────────────────────────────────────────────── */}
      {listError ? <p className="text-sm text-red-500">{listError}</p> : null}
      {rules.length === 0 && !draft ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="stagger-children flex flex-col gap-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              onClick={(e) => {
                // Match the rest of the CRM: a single click on the card opens it.
                // Ignore clicks landing on the inline controls.
                if (!canEdit || (e.target as HTMLElement).closest("button, a")) return;
                open(rule);
              }}
              title={canEdit ? t("openHint") : undefined}
              className={cn(
                "hover-lift glass rounded-xl border border-border p-4 shadow-sm",
                canEdit && "cursor-pointer select-none",
                !rule.enabled && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Zap className="size-4 shrink-0 text-brand" />
                    <h3 className="truncate font-medium">{rule.name}</h3>
                    {rule.config.minValue && !isWhatsappTrigger(rule.trigger) ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">≥ {rule.config.minValue}</span> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-md bg-brand/10 px-2 py-0.5 font-medium text-brand">
                      {t(`trigger.${rule.trigger}`)}
                      {triggerNeedsStage(rule.trigger) ? ` · ${stageName(rule.triggerStageId)}` : ""}
                      {isWhatsappTrigger(rule.trigger) && rule.config.whatsapp ? waSummary(rule.config.whatsapp) : ""}
                    </span>
                    {rule.actions.map((a, i) => (
                      <span key={i} className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">→ {actionSummary(a)}</span>
                    ))}
                  </div>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" role="switch" aria-checked={rule.enabled} onClick={() => toggle(rule.id, !rule.enabled)} disabled={pending} className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", rule.enabled ? "bg-brand" : "bg-muted")} aria-label={t("enabled")}>
                      <span className={cn("absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform", rule.enabled ? "translate-x-4" : "translate-x-0")} />
                    </button>
                    <button type="button" onClick={() => open(rule)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("edit")}><Pencil className="size-4" /></button>
                    <button type="button" onClick={() => remove(rule.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-red-600" aria-label={t("delete")}><Trash2 className="size-4" /></button>
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

// ── Presentational pieces ──────────────────────────────────────────────────

function CanvasNode({
  pos, selected, tone, icon: Icon, label, summary, onSelect, onDragStart, onRemove, removeLabel,
}: {
  pos: NodePos; selected: boolean; tone: string; icon: typeof Zap; label: string; summary: string;
  onSelect: () => void; onDragStart: (e: React.MouseEvent) => void; onRemove?: () => void; removeLabel?: string;
}) {
  return (
    <div
      onMouseDown={onSelect}
      className={cn("absolute rounded-xl border bg-card shadow-sm", selected ? "border-brand ring-2 ring-brand/40" : "border-border")}
      style={{ left: pos.x, top: pos.y, width: NODE_W }}
    >
      <div className={cn("flex cursor-grab items-center gap-2 rounded-t-xl px-3 py-2 active:cursor-grabbing", tone)} onMouseDown={onDragStart}>
        <Icon className="size-4" />
        <span className="truncate text-sm font-semibold">{label}</span>
        {onRemove ? (
          <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={onRemove} aria-label={removeLabel} className="ml-auto rounded p-0.5 hover:bg-black/10"><X className="size-3.5" /></button>
        ) : null}
      </div>
      <p className="truncate px-3 py-2 text-xs text-muted-foreground">{summary}</p>
    </div>
  );
}

function ActionInspector({
  action, onChange, onRemoveOption, onMoveOption, templates, stages, members, t,
}: {
  action: RuleAction; onChange: (a: RuleAction) => void;
  /** Menu options are canvas nodes too, so removing/reordering one goes through the editor. */
  onRemoveOption: (i: number) => void; onMoveOption: (i: number, delta: -1 | 1) => void;
  templates: Template[]; stages: Stage[]; members: Member[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`action.${action.type}`)}</p>

      {action.type === "ask_questions" ? (
        <>
          <Field label={t("welcomeMessage")}>
            <textarea value={action.firstMessage ?? ""} onChange={(e) => onChange({ ...action, firstMessage: e.target.value })} rows={3} placeholder={t("welcomeMessagePlaceholder")} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus-visible:border-brand focus-visible:outline-none" />
          </Field>
          <QuestionsEditor questions={action.questions} onChange={(questions) => onChange({ ...action, questions })} t={t} />
          <Field label={t("finalMessage")}>
            <textarea value={action.finalMessage ?? ""} onChange={(e) => onChange({ ...action, finalMessage: e.target.value })} rows={2} placeholder={t("finalMessagePlaceholder")} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus-visible:border-brand focus-visible:outline-none" />
          </Field>
        </>
      ) : null}

      {action.type === "ask_menu" ? (
        <MenuInspector step={action} onChange={onChange} onRemoveOption={onRemoveOption} onMoveOption={onMoveOption} t={t} />
      ) : null}

      {action.type === "create_opportunity" ? <p className="text-xs text-muted-foreground">{t("createOppHint")}</p> : null}

      {action.type === "create_task" ? (
        <>
          <Field label={t("taskTitle")}><Input value={action.title} onChange={(e) => onChange({ ...action, title: e.target.value })} placeholder={t("taskTitlePlaceholder")} className="h-9" /></Field>
          <Field label={t("taskDescription")}>
            <textarea value={action.description ?? ""} onChange={(e) => onChange({ ...action, description: e.target.value })} rows={2} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus-visible:border-brand focus-visible:outline-none" />
          </Field>
          <Field label={t("priority")}>
            <Select value={action.priority ?? "MEDIUM"} onChange={(v) => onChange({ ...action, priority: v as "LOW" | "MEDIUM" | "HIGH" })} options={["LOW", "MEDIUM", "HIGH"].map((p) => ({ value: p, label: t(`prio.${p}`) }))} />
          </Field>
          <Field label={t("dueInDays")}><Input value={action.dueInDays?.toString() ?? ""} onChange={(e) => onChange({ ...action, dueInDays: e.target.value ? Number(e.target.value) : undefined })} inputMode="numeric" placeholder="0" className="h-9" /></Field>
        </>
      ) : null}

      {action.type === "notify_owner" ? (
        <Field label={t("message")}>
          <textarea value={action.message ?? ""} onChange={(e) => onChange({ ...action, message: e.target.value })} rows={3} placeholder={t("messagePlaceholder")} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus-visible:border-brand focus-visible:outline-none" />
        </Field>
      ) : null}

      {action.type === "send_whatsapp" ? (
        <Field label={t("action.send_whatsapp")}>
          <Select value={action.templateId} onChange={(v) => onChange({ ...action, templateId: v })} placeholder={templates.length === 0 ? t("noTemplates") : undefined} options={templates.map((x) => ({ value: x.id, label: x.name }))} />
        </Field>
      ) : null}

      {action.type === "move_stage" ? (
        <Field label={t("stage")}>
          <Select value={action.stageId} onChange={(v) => onChange({ ...action, stageId: v })} placeholder={t("chooseStage")} options={stages.map((s) => ({ value: s.id, label: `${s.pipeline} · ${s.name}` }))} />
        </Field>
      ) : null}

      {action.type === "set_owner" ? (
        <Field label={t("owner")}>
          <Select value={action.userId} onChange={(v) => onChange({ ...action, userId: v })} placeholder={t("chooseOwner")} options={members.map((m) => ({ value: m.id, label: m.name }))} />
        </Field>
      ) : null}

      {action.type === "notify_user" ? (
        <>
          <Field label={t("owner")}>
            <Select value={action.userId} onChange={(v) => onChange({ ...action, userId: v })} placeholder={t("chooseOwner")} options={members.map((m) => ({ value: m.id, label: m.name }))} />
          </Field>
          <Field label={t("message")}>
            <textarea value={action.message ?? ""} onChange={(e) => onChange({ ...action, message: e.target.value })} rows={2} placeholder={t("messagePlaceholder")} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus-visible:border-brand focus-visible:outline-none" />
          </Field>
        </>
      ) : null}

      {action.type === "send_email" ? (
        <>
          <Field label={t("emailSubject")}><Input value={action.subject} onChange={(e) => onChange({ ...action, subject: e.target.value })} className="h-9" /></Field>
          <Field label={t("emailBody")}>
            <textarea value={action.body} onChange={(e) => onChange({ ...action, body: e.target.value })} rows={4} placeholder={t("emailBodyPlaceholder")} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus-visible:border-brand focus-visible:outline-none" />
          </Field>
        </>
      ) : null}

      {action.type === "set_expected_close" ? (
        <Field label={t("inDays")}><Input value={String(action.inDays)} onChange={(e) => onChange({ ...action, inDays: Number(e.target.value) || 0 })} inputMode="numeric" className="h-9" /></Field>
      ) : null}

      {action.type === "add_tag" ? (
        <Field label={t("tag")}><Input value={action.tag} onChange={(e) => onChange({ ...action, tag: e.target.value })} placeholder={t("tagPlaceholder")} className="h-9" /></Field>
      ) : null}

      {action.type === "create_finance_entry" ? (
        <>
          <Field label={t("financeDescription")}><Input value={action.description} onChange={(e) => onChange({ ...action, description: e.target.value })} placeholder={t("financeDescriptionPlaceholder")} className="h-9" /></Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={action.useOppValue !== false} onChange={(e) => onChange({ ...action, useOppValue: e.target.checked })} className="size-4 accent-[var(--brand)]" />
            {t("useOppValue")}
          </label>
          {action.useOppValue === false ? (
            <Field label={t("amount")}><Input value={action.amount?.toString() ?? ""} onChange={(e) => onChange({ ...action, amount: e.target.value ? Number(e.target.value) : undefined })} inputMode="numeric" className="h-9" /></Field>
          ) : null}
          <Field label={t("dueInDays")}><Input value={action.dueInDays?.toString() ?? ""} onChange={(e) => onChange({ ...action, dueInDays: e.target.value ? Number(e.target.value) : undefined })} inputMode="numeric" placeholder="0" className="h-9" /></Field>
        </>
      ) : null}

      {action.type === "webhook" ? (
        <Field label={t("webhookUrl")}><Input value={action.url} onChange={(e) => onChange({ ...action, url: e.target.value })} placeholder="https://…" className="h-9" /></Field>
      ) : null}
    </div>
  );
}
