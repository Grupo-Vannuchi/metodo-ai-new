"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, MoreHorizontal, Pencil, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { COLUMN_NAME_MAX, type BoardColumn } from "@/lib/tasks/board-core";
import type { TaskRow } from "@/lib/queries/tasks";
import { BoardCard } from "@/components/tasks/board-card";

type Props = {
  column: BoardColumn;
  cards: TaskRow[];
  columns: BoardColumn[];
  isFirst: boolean;
  isLast: boolean;
  dragId: string | null;
  /** Drop indicator in this column: undefined = none, null = at the end, id = above that card. */
  dropBeforeId: string | null | undefined;
  onDragStartCard: (id: string) => void;
  onDragEndCard: () => void;
  onDragOverBody: (e: React.DragEvent<HTMLDivElement>) => void;
  onDropBody: () => void;
  onRename: (name: string) => void;
  onShift: (direction: "left" | "right") => void;
  onMakeEntrance: () => void;
  onDelete: () => void;
  onToggleDone: (id: string, done: boolean) => void;
  onDeleteCard: (task: TaskRow) => void;
  onMoveCardTo: (taskId: string, columnId: string) => void;
};

const DropLine = () => <div className="h-0.5 shrink-0 rounded-full bg-brand" />;

/** One kanban column: title (click to rename), entrance star, card count, the
 * "⋯" menu, and the drop zone with its cards. */
export function BoardColumnView(props: Props) {
  const { column, cards, columns, isFirst, isLast, dragId, dropBeforeId } = props;
  const t = useTranslations("tasks");
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function startEditing() {
    setMenuOpen(false);
    setEditing(true);
  }

  function finishEditing(value: string) {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    props.onRename(value);
  }

  const item =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

  return (
    <div className="flex h-full w-72 shrink-0 flex-col">
      <div className="mb-3 flex items-center gap-2 px-1">
        {editing ? (
          <input
            autoFocus
            defaultValue={column.name}
            maxLength={COLUMN_NAME_MAX}
            aria-label={t("board.columnName")}
            onBlur={(e) => finishEditing(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                cancelled.current = true;
                e.currentTarget.blur();
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-brand bg-card px-2 py-0.5 text-sm font-semibold outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={startEditing}
            title={t("board.rename")}
            className="min-w-0 truncate text-left text-sm font-semibold transition-colors hover:text-brand"
          >
            {column.name}
          </button>
        )}
        {column.isEntrance ? (
          <span title={t("board.entrance")} className="shrink-0">
            <Star className="size-3.5 fill-amber-400 text-amber-400" aria-label={t("board.entrance")} />
          </span>
        ) : null}
        <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">{cards.length}</span>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={t("board.columnMenu")}
            aria-expanded={menuOpen}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </button>
          {menuOpen ? (
            <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-60 rounded-lg border border-border bg-card p-1 shadow-lg">
              <button type="button" role="menuitem" className={item} onClick={startEditing}>
                <Pencil className="size-4" />
                {t("board.rename")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                disabled={column.isEntrance}
                onClick={() => {
                  setMenuOpen(false);
                  props.onMakeEntrance();
                }}
              >
                <Star className="size-4" />
                {t("board.setEntrance")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                disabled={isFirst}
                onClick={() => {
                  setMenuOpen(false);
                  props.onShift("left");
                }}
              >
                <ArrowLeft className="size-4" />
                {t("board.moveLeft")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                disabled={isLast}
                onClick={() => {
                  setMenuOpen(false);
                  props.onShift("right");
                }}
              >
                <ArrowRight className="size-4" />
                {t("board.moveRight")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={cn(item, "text-red-600")}
                disabled={column.isEntrance}
                title={column.isEntrance ? t("board.entranceCantDelete") : undefined}
                onClick={() => {
                  setMenuOpen(false);
                  props.onDelete();
                }}
              >
                <Trash2 className="size-4" />
                {t("board.deleteColumn")}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div
        onDragOver={props.onDragOverBody}
        onDrop={(e) => {
          e.preventDefault();
          props.onDropBody();
        }}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl border bg-muted/30 p-2 transition-colors",
          dropBeforeId !== undefined ? "border-brand bg-brand/5" : "border-border",
        )}
      >
        {cards.map((task) => (
          <Fragment key={task.id}>
            {dropBeforeId === task.id ? <DropLine /> : null}
            <BoardCard
              task={task}
              columnId={column.id}
              columns={columns}
              dragging={dragId === task.id}
              onDragStart={props.onDragStartCard}
              onDragEnd={props.onDragEndCard}
              onToggleDone={props.onToggleDone}
              onDelete={props.onDeleteCard}
              onMoveTo={props.onMoveCardTo}
            />
          </Fragment>
        ))}
        {dropBeforeId === null ? <DropLine /> : null}
        {cards.length === 0 && dropBeforeId === undefined ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            {t("board.empty")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
