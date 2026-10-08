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
  compareBoardCards,
  effectiveColumnId,
  normalizeColumnName,
  orderForInsert,
  type BoardColumn,
} from "@/lib/tasks/board-core";
import type { TaskRow } from "@/lib/queries/tasks";
import { BoardColumnView } from "@/components/tasks/board-column";

/** Distance from the board's left/right edge that scrolls it while dragging. */
const EDGE_PX = 80;
const SCROLL_STEP = 24;

/**
 * The org's task kanban: free columns (renamed/added/removed by members) and
 * cards dragged between and inside them. A column means nothing to the task —
 * completing is only the check, and it never moves the card. Cards open on click.
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
  const [drop, setDrop] = useState<{ columnId: string; beforeId: string | null } | null>(null);
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
  for (const list of grouped.values()) list.sort(compareBoardCards);

  function errorText(r: TaskBoardResult): string {
    if (r.ok) return "";
    if (r.error === "limit") return t("board.errorLimit", { max: LIMITS.taskBoardColumnsMax });
    if (r.error === "entrance") return t("board.entranceCantDelete");
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

  function moveCard(taskId: string, columnId: string, beforeId: string | null) {
    const list = (grouped.get(columnId) ?? []).filter((c) => c.id !== taskId);
    const found = beforeId ? list.findIndex((c) => c.id === beforeId) : -1;
    const index = found === -1 ? list.length : found;
    // Optimistic position; when the neighbours are too close the server
    // renumbers, and the refresh brings the final order.
    const order =
      orderForInsert(
        list.map((c) => c.boardOrder),
        index,
      ) ?? list[index]?.boardOrder ?? 0;
    setItems((prevItems) =>
      prevItems.map((x) => (x.id === taskId ? { ...x, boardColumnId: columnId, boardOrder: order } : x)),
    );
    run(() => moveTaskOnBoard(taskId, columnId, beforeId));
  }

  function onDragOverColumn(e: React.DragEvent<HTMLDivElement>, columnId: string) {
    e.preventDefault();
    if (!dragId) return;
    // The drop slot: above the first card whose middle is below the pointer.
    let beforeId: string | null = null;
    for (const el of e.currentTarget.querySelectorAll<HTMLElement>("[data-task-id]")) {
      if (el.dataset.taskId === dragId) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        beforeId = el.dataset.taskId ?? null;
        break;
      }
    }
    if (drop?.columnId !== columnId || drop.beforeId !== beforeId) setDrop({ columnId, beforeId });
  }

  function onDropColumn(columnId: string) {
    const id = dragId;
    const target = drop;
    setDragId(null);
    setDrop(null);
    if (!id || !target || target.columnId !== columnId) return;
    // Dropped back exactly where it was: nothing to save.
    const list = grouped.get(columnId) ?? [];
    const pos = list.findIndex((c) => c.id === id);
    if (pos !== -1) {
      const nextId = list.slice(pos + 1).find((c) => c.id !== id)?.id ?? null;
      if (nextId === target.beforeId) return;
    }
    moveCard(id, columnId, target.beforeId);
  }

  /** Scroll the board while a card is dragged near its left/right edge. */
  function onDragOverBoard(e: React.DragEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el || !dragId) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left + EDGE_PX) el.scrollLeft -= SCROLL_STEP;
    else if (e.clientX > r.right - EDGE_PX) el.scrollLeft += SCROLL_STEP;
  }

  function setDone(id: string, done: boolean) {
    setItems((prevItems) => prevItems.map((x) => (x.id === id ? { ...x, doneAt: done ? new Date() : null } : x)));
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
      setItems((prevItems) => prevItems.map((x) => (x.boardColumnId === column.id ? { ...x, boardColumnId: null } : x)));
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
            dropBeforeId={drop?.columnId === column.id ? drop.beforeId : undefined}
            onDragStartCard={setDragId}
            onDragEndCard={() => {
              setDragId(null);
              setDrop(null);
            }}
            onDragOverBody={(e) => onDragOverColumn(e, column.id)}
            onDropBody={() => onDropColumn(column.id)}
            onRename={(name) => rename(column, name)}
            onShift={(direction) => shiftColumn(column, direction)}
            onMakeEntrance={() => makeEntrance(column)}
            onDelete={() => removeColumn(column)}
            onToggleDone={setDone}
            onDeleteCard={removeCard}
            onMoveCardTo={(taskId, columnId) => moveCard(taskId, columnId, null)}
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
