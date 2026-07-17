"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Trash2, Link2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { useRealtime } from "@/components/app/realtime-provider";
import { toggleTask, deleteTask } from "@/app/actions/tasks";
import type { TaskRow } from "@/lib/queries/tasks";

type ColKey = "overdue" | "today" | "upcoming" | "nodate" | "done";
const COLS: ColKey[] = ["overdue", "today", "upcoming", "nodate", "done"];

/** Which board column a task belongs to (situation/deadline buckets). */
function bucketOf(task: TaskRow, todayStart: number, tomorrowStart: number): ColKey {
  if (task.doneAt) return "done";
  if (!task.dueDate) return "nodate";
  const d = new Date(task.dueDate).getTime();
  if (d < todayStart) return "overdue";
  if (d < tomorrowStart) return "today";
  return "upcoming";
}

/**
 * Kanban view of tasks bucketed by situation/deadline. Dragging a card into
 * "Concluídas" completes it (and dragging it back out reopens it); the deadline
 * columns are a visual grouping, so dragging between them is a no-op. Cards open
 * on double-click, matching the rest of the app.
 */
export function TasksBoard({ tasks }: { tasks: TaskRow[] }) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const confirm = useConfirm();
  const [items, setItems] = useState(tasks);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ColKey | null>(null);
  const [, start] = useTransition();

  // Adopt fresh server data when the prop changes (derive-from-props pattern).
  const [prevTasks, setPrevTasks] = useState(tasks);
  if (prevTasks !== tasks) {
    setPrevTasks(tasks);
    setItems(tasks);
  }

  // Live updates from other users — but never yank the board mid-drag.
  useRealtime("tasks", () => {
    if (!dragId) router.refresh();
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const tomorrowMs = todayMs + 24 * 60 * 60 * 1000;

  const grouped: Record<ColKey, TaskRow[]> = { overdue: [], today: [], upcoming: [], nodate: [], done: [] };
  for (const task of items) grouped[bucketOf(task, todayMs, tomorrowMs)].push(task);

  function setDone(id: string, done: boolean) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, doneAt: done ? new Date() : null } : x)));
    start(async () => {
      await toggleTask(id, done);
      router.refresh();
    });
  }

  function onDrop(col: ColKey) {
    setOverCol(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const task = items.find((x) => x.id === id);
    if (!task) return;
    const wantDone = col === "done";
    // Only the done/undone transition is meaningful — deadline columns are visual.
    if (wantDone === (task.doneAt != null)) return;
    setDone(id, wantDone);
  }

  function remove(task: TaskRow) {
    confirm({ description: t("deleteConfirm", { title: task.title }), confirmLabel: t("delete"), variant: "danger" }).then((ok) => {
      if (!ok) return;
      setItems((prev) => prev.filter((x) => x.id !== task.id));
      start(async () => {
        await deleteTask(task.id);
        router.refresh();
      });
    });
  }

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex h-full min-w-max gap-3">
        {COLS.map((col) => {
          const cards = grouped[col];
          return (
            <div key={col} className="flex h-full w-72 shrink-0 flex-col">
              <div className="mb-3 flex items-center justify-between gap-2 px-1">
                <span className={cn("text-sm font-semibold", col === "overdue" && "text-red-600")}>
                  {t(`board.${col}`)}
                </span>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">{cards.length}</span>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(col);
                }}
                onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
                onDrop={() => onDrop(col)}
                className={cn(
                  "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl border bg-muted/30 p-2 transition-colors",
                  overCol === col ? "border-brand bg-brand/5" : "border-border",
                )}
              >
                {cards.map((task) => {
                  const done = task.doneAt != null;
                  const overdue = col === "overdue";
                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => setDragId(task.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button, a")) return;
                        router.push(`/app/tasks/${task.id}`);
                      }}
                      title={t("openHint")}
                      className="hover-lift cursor-pointer select-none rounded-lg border border-border bg-card p-3 shadow-sm active:cursor-grabbing"
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => setDone(task.id, !done)}
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
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            {task.dueDate ? (
                              <span className={cn(overdue && "font-medium text-red-600")}>{fmtDate(task.dueDate)}</span>
                            ) : null}
                            <span className="rounded bg-muted px-1.5 py-0.5">{t(`type.${task.type}`)}</span>
                            {task.assignedToName ? <span>· {task.assignedToName}</span> : null}
                          </div>
                          {task.opportunityId || task.contactId ? (
                            <div className="mt-1 flex items-center gap-0.5 text-xs text-muted-foreground">
                              <Link2 className="size-3" />
                              {task.opportunityId ? (
                                <Link href={`/app/crm/${task.opportunityId}`} className="truncate hover:underline">
                                  {task.opportunityTitle}
                                </Link>
                              ) : task.contactId ? (
                                <Link href={`/app/contacts/${task.contactId}`} className="truncate hover:underline">
                                  {task.contactName}
                                </Link>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(task)}
                          aria-label={t("delete")}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {cards.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("board.empty")}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
