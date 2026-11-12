"use client";

import type { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/field";
import { formatMenu, menuList } from "@/lib/automation/menu";
import {
  MAX_FLOW_QUESTIONS,
  MAX_MENU_OPTIONS,
  QUESTION_FIELDS,
  type FlowQuestion,
  type MenuOption,
  type QuestionField,
  type RuleAction,
} from "@/lib/automation/types";

/** Inspector panels of the WhatsApp flow steps, plus the small form pieces the
 *  automation editor shares with them. */

type Translator = ReturnType<typeof useTranslations>;
type MenuStep = Extract<RuleAction, { type: "ask_menu" }>;

const TEXTAREA = "rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus-visible:border-brand focus-visible:outline-none";
const ICON_BUTTON = "rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30";
const ADD_BUTTON = "inline-flex items-center gap-1 self-start text-xs font-medium text-brand hover:underline disabled:opacity-50";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none">
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** The ordered questions of "Fazer perguntas" or of one menu option. */
export function QuestionsEditor({
  questions, onChange, empty, t,
}: {
  questions: FlowQuestion[]; onChange: (q: FlowQuestion[]) => void; empty?: string; t: Translator;
}) {
  const patch = (i: number, next: Partial<FlowQuestion>) => onChange(questions.map((x, j) => (j === i ? { ...x, ...next } : x)));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t("questions")}</span>
      {questions.length === 0 && empty ? (
        <p className="rounded-lg border border-dashed border-border p-2 text-xs text-muted-foreground">{empty}</p>
      ) : null}
      {questions.map((q, i) => (
        <div key={i} className="flex flex-col gap-1 rounded-lg border border-border p-2">
          <div className="flex items-start gap-1.5">
            <span className="mt-1.5 w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <textarea
              value={q.label}
              onChange={(e) => patch(i, { label: e.target.value.slice(0, 300) })}
              placeholder={t("questionPlaceholder")}
              aria-label={`${t("questions")} ${i + 1}`}
              rows={2}
              className={`min-w-0 flex-1 ${TEXTAREA}`}
            />
            <button type="button" onClick={() => onChange(questions.filter((_, j) => j !== i))} aria-label={t("removeQuestion")} className={`mt-1 ${ICON_BUTTON}`}><X className="size-3.5" /></button>
          </div>
          <Select
            value={q.field}
            onChange={(v) => patch(i, { field: v as QuestionField })}
            options={QUESTION_FIELDS.map((f) => ({ value: f, label: t(`answerField.${f}`) }))}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...questions, { label: "", field: "notes" }])}
        disabled={questions.length >= MAX_FLOW_QUESTIONS}
        className={ADD_BUTTON}
      >
        <Plus className="size-3.5" />
        {t("addQuestion")}
      </button>
      <p className="text-xs text-muted-foreground">{t("questionsHint")}</p>
    </div>
  );
}

/** The "Menu de opções" step: welcome, the menu question and its options. Each
 *  option's questions are edited on its own canvas node (OptionInspector).
 *  Removing or reordering an option also moves its node, so the editor owns those. */
export function MenuInspector({
  step, onChange, onRemoveOption, onMoveOption, t,
}: {
  step: MenuStep;
  onChange: (s: MenuStep) => void;
  onRemoveOption: (i: number) => void;
  onMoveOption: (i: number, delta: -1 | 1) => void;
  t: Translator;
}) {
  const labels = step.options.map((o, i) => o.label.trim() || t("optionTitle", { n: i + 1 }));
  const setLabel = (i: number, label: string) =>
    onChange({ ...step, options: step.options.map((x, j) => (j === i ? { ...x, label } : x)) });
  return (
    <>
      <Field label={t("welcomeMessage")}>
        <textarea value={step.firstMessage ?? ""} onChange={(e) => onChange({ ...step, firstMessage: e.target.value })} rows={2} placeholder={t("welcomeMessagePlaceholder")} className={TEXTAREA} />
      </Field>
      <Field label={t("menuQuestion")}>
        <textarea value={step.question} onChange={(e) => onChange({ ...step, question: e.target.value.slice(0, 300) })} rows={2} placeholder={t("menuQuestionPlaceholder")} className={TEXTAREA} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t("menuOptions")}</span>
        {step.options.map((o, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <Input
              value={o.label}
              onChange={(e) => setLabel(i, e.target.value.slice(0, 60))}
              placeholder={t("menuOptionPlaceholder")}
              aria-label={`${t("menuOptions")} ${i + 1}`}
              className="h-8 min-w-0 flex-1"
            />
            <button type="button" onClick={() => onMoveOption(i, -1)} disabled={i === 0} aria-label={t("moveOptionUp")} title={t("moveOptionUp")} className={ICON_BUTTON}><ChevronUp className="size-3.5" /></button>
            <button type="button" onClick={() => onMoveOption(i, 1)} disabled={i === step.options.length - 1} aria-label={t("moveOptionDown")} title={t("moveOptionDown")} className={ICON_BUTTON}><ChevronDown className="size-3.5" /></button>
            <button type="button" onClick={() => onRemoveOption(i)} aria-label={t("removeOption")} title={t("removeOption")} className={ICON_BUTTON}><X className="size-3.5" /></button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...step, options: [...step.options, { label: "", questions: [] }] })}
          disabled={step.options.length >= MAX_MENU_OPTIONS}
          className={ADD_BUTTON}
        >
          <Plus className="size-3.5" />
          {t("addOption")}
        </button>
        <p className="text-xs text-muted-foreground">{t("menuOptionsHint")}</p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t("menuPreview")}</span>
        <p className="whitespace-pre-line rounded-lg bg-muted px-3 py-2 text-sm">
          {step.question.trim() ? formatMenu(step.question, labels) : menuList(labels)}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{t("menuInvalidHint")}</p>
    </>
  );
}

/** One option of the menu: its name, its questions and its closing message. */
export function OptionInspector({
  index, option, onChange, t,
}: {
  index: number; option: MenuOption; onChange: (o: MenuOption) => void; t: Translator;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("optionTitle", { n: index + 1 })}</p>
      <Field label={t("optionLabel")}>
        <Input value={option.label} onChange={(e) => onChange({ ...option, label: e.target.value.slice(0, 60) })} placeholder={t("menuOptionPlaceholder")} className="h-9" />
      </Field>
      <QuestionsEditor questions={option.questions} onChange={(questions) => onChange({ ...option, questions })} empty={t("optionNoQuestions")} t={t} />
      <Field label={t("finalMessage")}>
        <textarea value={option.finalMessage ?? ""} onChange={(e) => onChange({ ...option, finalMessage: e.target.value })} rows={2} placeholder={t("finalMessagePlaceholder")} className={TEXTAREA} />
      </Field>
    </div>
  );
}
