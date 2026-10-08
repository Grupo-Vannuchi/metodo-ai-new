"use client";

import { useTranslations } from "next-intl";
import { ArrowRightLeft, Check, Link2, ListChecks, Paperclip, Repeat, Trash2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { BoardColumn } from "@/lib/tasks/board-core";
import type { TaskRow } from "@/lib/queries/tasks";

type Props = {
  task: TaskRow;
  columnId: string;
  columns: BoardColumn[];
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onToggleDone: (id: string, done: boolean) => void;
  onDelete: (task: TaskRow) => void;
  onMoveTo: (taskId: string, columnId: string) => void;
};

const fmtDate = (d: Date) =>
  new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** A task card. The whole card drags; "Mover para…" is a native select (works
 * on touch screens, where dragging doesn't); the check never moves the card. */
export function BoardCard({ task, columnId, columns, dragging, onDragStart, onDragEnd, onToggleDone, onDelete, onMoveTo }: Props) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const done = task.doneAt != null;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const overdue = !done && task.dueDate != null && new Date(task.dueDate).getTime() < todayStart.getTime();

  return (
    <div
      data-task-id={task.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id); // Firefox needs data to start a drag
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, select, label")) return;
        router.push(`/app/tasks/${task.id}`);
      }}
      title={t("openHint")}
      className={cn(
        "hover-lift cursor-pointer select-none rounded-lg border border-border bg-card p-3 shadow-sm active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onToggleDone(task.id, !done)}
          aria-label={done ? t("reopen") : t("complete")}
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            done ? "border-green-500 bg-green-500 text-white" : "border-border hover:border-brand",
          )}
        >
          {done ? <Check className="size-3.5" /> : null}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}>{task.title}</p>
            {!done && task.status === "IN_PROGRESS" ? (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                {t("status.IN_PROGRESS")}
              </span>
            ) : null}
          </div>
          {!done && task.progress > 0 && task.progress < 100 ? (
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${task.progress}%` }} />
            </div>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {task.dueDate ? <span className={cn(overdue && "font-medium text-red-600")}>{fmtDate(task.dueDate)}</span> : null}
            <span className="rounded bg-muted px-1.5 py-0.5">{t(`type.${task.type}`)}</span>
            {task.checklistTotal > 0 ? (
              <span className="inline-flex items-center gap-0.5">
                <ListChecks className="size-3" />
                {task.checklistDone}/{task.checklistTotal}
              </span>
            ) : null}
            {task.attachmentCount > 0 ? (
              <span className="inline-flex items-center gap-0.5">
                <Paperclip className="size-3" />
                {task.attachmentCount}
              </span>
            ) : null}
            {task.recurrence !== "NONE" ? <Repeat className="size-3" aria-label={t("recurring")} /> : null}
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
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <label
            title={t("board.moveTo")}
            className="relative rounded-md p-1 text-muted-foreground transition-colors focus-within:ring-2 focus-within:ring-brand hover:bg-muted hover:text-foreground"
          >
            <ArrowRightLeft className="size-4" />
            <select
              aria-label={t("board.moveTo")}
              value={columnId}
              onChange={(e) => onMoveTo(task.id, e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onDelete(task)}
            aria-label={t("delete")}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
