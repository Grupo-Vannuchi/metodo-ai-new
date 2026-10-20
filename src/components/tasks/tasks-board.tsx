"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { usePrompt } from "@/components/ui/prompt";
import { useToast } from "@/components/ui/toast";
import { useRealtime } from "@/components/app/realtime-provider";
import { toggleTask, deleteTask } from "@/app/actions/tasks";
import {
  createTaskBoardColumn,
  deleteTaskBoardColumn,
  moveTaskBoardColumn,
  moveTaskOnBoard,
  renameTaskBoardColumn,
  setTaskBoardEntrance,
  type TaskBoardResult,
} from "@/app/actions/task-board";
import { LIMITS } from "@/config/limits";
import {
  cardOrderFor,
  columnForDoneChange,
  doneAfterMove,
  effectiveColumnId,
  normalizeColumnName,
  type BoardColumn,
} from "@/lib/tasks/board-core";
import type { TaskRow } from "@/lib/queries/tasks";
import { BoardColumnView } from "@/components/tasks/board-column";

/** Distance from the board's left/right edge that scrolls it while dragging. */
const EDGE_PX = 80;
const SCROLL_STEP = 24;

/**
 * The org's task kanban: free columns (renamed/added/removed by members) and
 * cards dragged between them. Inside a column the cards go by due date (the
 * done column: last completed first), so a drag only picks the column. One
 * column is the done column: completing a task (check or drop there) puts its
 * card in it, and reopening (uncheck or drag out) takes it out. Cards open on click.
 */
export function TasksBoard({ tasks, columns }: { tasks: TaskRow[]; columns: BoardColumn[] }) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const toast = useToast();
  const [items, setItems] = useState(tasks);
  const [cols, setCols] = useState(columns);
  const [dragId, setDragId] = useState<string | null>(null);
  /** The column the dragged card is over (highlighted as the drop target). */
  const [dropColumnId, setDropColumnId] = useState<string | null>(null);
  const [, start] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Adopt fresh server data when the props change (derive-from-props pattern).
  const [prev, setPrev] = useState({ tasks, columns });
  if (prev.tasks !== tasks || prev.columns !== columns) {
    setPrev({ tasks, columns });
    setItems(tasks);
    setCols(columns);
  }

  // Live updates from other members — but never yank the board mid-drag.
  useRealtime("tasks", () => {
    if (!dragId) router.refresh();
  });

  const entrance = cols.find((c) => c.isEntrance) ?? cols[0];
  const columnIds = new Set(cols.map((c) => c.id));
  const grouped = new Map<string, TaskRow[]>(cols.map((c) => [c.id, []]));
  if (entrance) {
    for (const task of items) grouped.get(effectiveColumnId(task.boardColumnId, columnIds, entrance.id))?.push(task);
  }
  for (const column of cols) grouped.get(column.id)?.sort(cardOrderFor(column));

  function errorText(r: TaskBoardResult): string {
    if (r.ok) return "";
    if (r.error === "limit") return t("board.errorLimit", { max: LIMITS.taskBoardColumnsMax });
    if (r.error === "entrance") return t("board.entranceCantDelete");
    if (r.error === "done_column") return t("board.doneColumnLocked");
    return t("board.errorSave");
  }

  /** Run a board action; on failure tell the user. Always resync with the server. */
  function run(action: () => Promise<TaskBoardResult>) {
    start(async () => {
      const r = await action();
      if (!r.ok) toast(errorText(r), { variant: "error" });
      router.refresh();
    });
  }

  /** The board column a card shows in right now. */
  function columnOf(task: TaskRow): string {
    return entrance ? effectiveColumnId(task.boardColumnId, columnIds, entrance.id) : "";
  }

  function moveCard(taskId: string, columnId: string) {
    const task = items.find((x) => x.id === taskId);
    // Same column: the date decides the position, so there's nothing to save.
    if (!task || columnOf(task) === columnId) return;
    // Dropping in / taking out of the done column completes / reopens (the
    // server does the same).
    const done = doneAfterMove(task.doneAt != null, columnOf(task), columnId, cols);
    const doneAt = done !== (task.doneAt != null) ? (done ? new Date() : null) : task.doneAt;
    setItems((prevItems) => prevItems.map((x) => (x.id === taskId ? { ...x, boardColumnId: columnId, doneAt } : x)));
    run(() => moveTaskOnBoard(taskId, columnId, null));
  }

  function onDragOverColumn(e: React.DragEvent<HTMLDivElement>, columnId: string) {
    e.preventDefault();
    if (dragId && dropColumnId !== columnId) setDropColumnId(columnId);
  }

  function onDropColumn(columnId: string) {
    const id = dragId;
    setDragId(null);
    setDropColumnId(null);
    if (id) moveCard(id, columnId);
  }

  /** Scroll the board while a card is dragged near its left/right edge. */
  function onDragOverBoard(e: React.DragEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el || !dragId) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left + EDGE_PX) el.scrollLeft -= SCROLL_STEP;
    else if (e.clientX > r.right - EDGE_PX) el.scrollLeft += SCROLL_STEP;
    // Over a header or a gap (not a column's card area): no drop target.
    const overBody = (e.target as HTMLElement).closest("[data-column-body]");
    if (!overBody && dropColumnId) setDropColumnId(null);
  }

  function setDone(id: string, done: boolean) {
    // Optimistic: completing moves the card to the done column, reopening it
    // from there to its date's column (as the server does).
    const task = items.find((x) => x.id === id);
    const target = task ? columnForDoneChange(done, task, cols, new Date()) : null;
    setItems((prevItems) =>
      prevItems.map((x) =>
        x.id !== id
          ? x
          : { ...x, doneAt: done ? new Date() : null, ...(target ? { boardColumnId: target.columnId } : {}) },
      ),
    );
    start(async () => {
      await toggleTask(id, done);
      router.refresh();
    });
  }

  function removeCard(task: TaskRow) {
    confirm({ description: t("deleteConfirm", { title: task.title }), confirmLabel: t("delete"), variant: "danger" }).then((ok) => {
      if (!ok) return;
      setItems((prevItems) => prevItems.filter((x) => x.id !== task.id));
      start(async () => {
        await deleteTask(task.id);
        router.refresh();
      });
    });
  }

  async function addColumn() {
    const raw = await prompt({ title: t("board.addColumn"), label: t("board.columnName"), confirmLabel: t("save") });
    if (raw === null) return;
    const name = normalizeColumnName(raw);
    if (!name) {
      toast(t("board.errorName"), { variant: "error" });
      return;
    }
    run(() => createTaskBoardColumn(name));
  }

  function rename(column: BoardColumn, raw: string) {
    const name = normalizeColumnName(raw);
    if (!name) {
      toast(t("board.errorName"), { variant: "error" });
      return;
    }
    if (name === column.name) return;
    setCols((prevCols) => prevCols.map((c) => (c.id === column.id ? { ...c, name } : c)));
    run(() => renameTaskBoardColumn(column.id, name));
  }

  function shiftColumn(column: BoardColumn, direction: "left" | "right") {
    setCols((prevCols) => {
      const i = prevCols.findIndex((c) => c.id === column.id);
      const j = direction === "left" ? i - 1 : i + 1;
      if (i === -1 || j < 0 || j >= prevCols.length) return prevCols;
      const next = [...prevCols];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    run(() => moveTaskBoardColumn(column.id, direction));
  }

  function makeEntrance(column: BoardColumn) {
    // Cards with no column stay in the old entrance (the server writes it on them).
    const oldId = entrance?.id ?? null;
    if (oldId) {
      setItems((prevItems) => prevItems.map((x) => (x.boardColumnId === null ? { ...x, boardColumnId: oldId } : x)));
    }
    setCols((prevCols) => prevCols.map((c) => ({ ...c, isEntrance: c.id === column.id })));
    run(() => setTaskBoardEntrance(column.id));
  }

  function removeColumn(column: BoardColumn) {
    const count = grouped.get(column.id)?.length ?? 0;
    confirm({
      description: t("board.deleteColumnConfirm", { name: column.name, count, entrance: entrance?.name ?? "" }),
      confirmLabel: t("board.deleteColumn"),
      variant: "danger",
    }).then((ok) => {
      if (!ok) return;
      const entranceId = entrance?.id ?? null;
      setItems((prevItems) => prevItems.map((x) => (x.boardColumnId === column.id ? { ...x, boardColumnId: entranceId } : x)));
      setCols((prevCols) => prevCols.filter((c) => c.id !== column.id));
      run(() => deleteTaskBoardColumn(column.id));
    });
  }

  return (
    <div
      ref={scrollRef}
      onDragOver={onDragOverBoard}
      className="board-scroll min-h-0 flex-1 overflow-x-auto overflow-y-hidden pb-2"
    >
      <div className="flex h-full min-w-max gap-3">
        {cols.map((column, i) => (
          <BoardColumnView
            key={column.id}
            column={column}
            cards={grouped.get(column.id) ?? []}
            columns={cols}
            isFirst={i === 0}
            isLast={i === cols.length - 1}
            dragId={dragId}
            dropTarget={dropColumnId === column.id}
            onDragStartCard={setDragId}
            onDragEndCard={() => {
              setDragId(null);
              setDropColumnId(null);
            }}
            onDragOverBody={(e) => onDragOverColumn(e, column.id)}
            onDropBody={() => onDropColumn(column.id)}
            onRename={(name) => rename(column, name)}
            onShift={(direction) => shiftColumn(column, direction)}
            onMakeEntrance={() => makeEntrance(column)}
            onDelete={() => removeColumn(column)}
            onToggleDone={setDone}
            onDeleteCard={removeCard}
            onMoveCardTo={moveCard}
          />
        ))}
        <button
          type="button"
          onClick={addColumn}
          className="flex h-10 w-60 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
        >
          <Plus className="size-4" />
          {t("board.addColumn")}
        </button>
      </div>
    </div>
  );
}
