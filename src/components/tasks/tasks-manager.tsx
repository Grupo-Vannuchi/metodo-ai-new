"use client";

import { useState, useTransition } from "react";
import { Check, Eye, Pencil, Trash2, Plus, X, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";
import { useRealtime } from "@/components/app/realtime-provider";
import { createTask, updateTask, toggleTask, deleteTask } from "@/app/actions/tasks";
import type { TaskRow } from "@/lib/queries/tasks";

type Option = { id: string; name: string };
type Fixed = { contactId?: string; companyId?: string; opportunityId?: string };
type Tab = "open" | "today" | "overdue" | "upcoming" | "done";

const TYPES = ["CALL", "MEETING", "EMAIL", "WHATSAPP", "FOLLOWUP", "OTHER"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

const selectCls = cn(
  "h-[42px] w-full rounded-lg border border-border bg-card px-3 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

const toLocal = (d: Date | string | null) =>
  d ? new Date(d).toISOString().slice(0, 16) : "";

function isOverdue(d: Date | string | null, done: boolean) {
  return !done && d != null && new Date(d).getTime() < Date.now();
}

export function TasksManager({
  tasks,
  members,
  contacts = [],
  opportunities = [],
  fixed,
  currentUserId,
  showTabs = false,
}: {
  tasks: TaskRow[];
  members: Option[];
  contacts?: Option[];
  opportunities?: Option[];
  fixed?: Fixed;
  currentUserId: string;
  showTabs?: boolean;
}) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [tab, setTab] = useState<Tab>("open");

  const editing = editingId ? tasks.find((x) => x.id === editingId) ?? null : null;
  const formOpen = adding || editing != null;

  // Live task updates from other users — but don't refresh over an open form.
  useRealtime("tasks", () => {
    if (!formOpen) router.refresh();
  });

  const filtered = tasks.filter((x) => {
    const done = x.doneAt != null;
    if (tab === "done") return done;
    if (done) return false;
    if (tab === "overdue") return isOverdue(x.dueDate, false);
    if (tab === "today") {
      if (!x.dueDate) return false;
      const d = new Date(x.dueDate);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }
    if (tab === "upcoming") {
      if (!x.dueDate) return true;
      const d = new Date(x.dueDate);
      d.setHours(0, 0, 0, 0);
      const tmr = new Date();
      tmr.setHours(0, 0, 0, 0);
      tmr.setDate(tmr.getDate() + 1);
      return d.getTime() >= tmr.getTime();
    }
    return true; // open
  });

  function closeForm() {
    setEditingId(null);
    setAdding(false);
    setError(null);
    setFormKey((k) => k + 1);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const r = editing ? await updateTask(editing.id, fd) : await createTask(fd);
      if (r.ok) {
        closeForm();
        router.refresh();
      } else {
        setError(t(`error.${r.error}`));
      }
    });
  }

  function onToggle(task: TaskRow) {
    start(async () => {
      await toggleTask(task.id, task.doneAt == null);
      router.refresh();
    });
  }

  async function onDelete(task: TaskRow) {
    if (!(await confirm({ description: t("deleteConfirm", { title: task.title }), confirmLabel: t("delete"), variant: "danger" })))
      return;
    start(async () => {
      await deleteTask(task.id);
      router.refresh();
    });
  }

  const tabCls = (active: boolean) =>
    cn("rounded-lg px-3 py-1.5 text-sm transition-colors", active ? "bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:bg-muted");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showTabs ? (
          <div className="flex flex-wrap items-center gap-1">
            {(["open", "today", "overdue", "upcoming", "done"] as Tab[]).map((s) => (
              <button key={s} type="button" className={tabCls(tab === s)} onClick={() => setTab(s)}>
                {t(`tab.${s}`)}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="text-sm font-semibold">{t("title")}</h2>
        )}
        {!formOpen ? (
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t("newTask")}
          </Button>
        ) : null}
      </div>

      {formOpen ? (
        <form
          key={formKey}
          onSubmit={onSubmit}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
        >
          {fixed?.contactId ? <input type="hidden" name="contactId" value={fixed.contactId} /> : null}
          {fixed?.companyId ? <input type="hidden" name="companyId" value={fixed.companyId} /> : null}
          {fixed?.opportunityId ? <input type="hidden" name="opportunityId" value={fixed.opportunityId} /> : null}

          <div>
            <Label htmlFor="title">{t("field.title")}</Label>
            <Input id="title" name="title" defaultValue={editing?.title ?? ""} required maxLength={200} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="dueDate">{t("field.dueDate")}</Label>
              <Input id="dueDate" name="dueDate" type="datetime-local" defaultValue={toLocal(editing?.dueDate ?? null)} />
            </div>
            <div>
              <Label htmlFor="type">{t("field.type")}</Label>
              <select id="type" name="type" defaultValue={editing?.type ?? "FOLLOWUP"} className={selectCls}>
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>{t(`type.${ty}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="priority">{t("field.priority")}</Label>
              <select id="priority" name="priority" defaultValue={editing?.priority ?? "MEDIUM"} className={selectCls}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{t(`priority.${p}`)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={cn("grid gap-3", fixed ? "sm:grid-cols-1" : "sm:grid-cols-3")}>
            <div>
              <Label htmlFor="assignedToId">{t("field.assignee")}</Label>
              <select id="assignedToId" name="assignedToId" defaultValue={editing?.assignedToId ?? currentUserId} className={selectCls}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            {!fixed ? (
              <>
                <div>
                  <Label htmlFor="contactId">{t("field.contact")}</Label>
                  <select id="contactId" name="contactId" defaultValue={editing?.contactId ?? ""} className={selectCls}>
                    <option value="">—</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="opportunityId">{t("field.opportunity")}</Label>
                  <select id="opportunityId" name="opportunityId" defaultValue={editing?.opportunityId ?? ""} className={selectCls}>
                    <option value="">—</option>
                    {opportunities.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}
          </div>

          {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
            <button type="button" onClick={closeForm} className="inline-flex items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground">
              <X className="size-4" />
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((task) => {
            const done = task.doneAt != null;
            const overdue = isOverdue(task.dueDate, done);
            return (
              <li
                key={task.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
              >
                <button
                  type="button"
                  onClick={() => onToggle(task)}
                  disabled={pending}
                  aria-label={done ? t("reopen") : t("complete")}
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                    done ? "border-green-500 bg-green-500 text-white" : "border-border hover:border-brand",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : null}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}>
                    {task.title}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {task.dueDate ? (
                      <span className={cn(overdue && "font-medium text-red-600")}>
                        {new Date(task.dueDate).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    ) : null}
                    <span className="rounded bg-muted px-1.5 py-0.5">{t(`type.${task.type}`)}</span>
                    {task.assignedToName ? <span>· {task.assignedToName}</span> : null}
                    {!fixed && (task.opportunityTitle || task.contactName) ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Link2 className="size-3" />
                        {task.opportunityId ? (
                          <Link href={`/app/crm/${task.opportunityId}`} className="hover:underline">{task.opportunityTitle}</Link>
                        ) : task.contactId ? (
                          <Link href={`/app/contacts/${task.contactId}`} className="hover:underline">{task.contactName}</Link>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Link
                    href={`/app/tasks/${task.id}`}
                    aria-label={t("view")}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Eye className="size-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => { setEditingId(task.id); setAdding(false); setFormKey((k) => k + 1); }}
                    aria-label={t("edit")}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(task)}
                    disabled={pending}
                    aria-label={t("delete")}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
