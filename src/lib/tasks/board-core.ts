/**
 * Pure rules of the task kanban (no DB, no `server-only`): the board's initial
 * placement, where new, completed and reopened cards go, card ordering and
 * column-name validation. Shared by the server
 * (src/lib/tasks/board.ts, src/app/actions/task-board.ts) and the board UI;
 * covered by `npm run check:tasks`.
 */

/** The 5 columns every org's board starts with, left to right — the old
 * automatic buckets. Names come from `tasks.board.<bucket>` of the first opener. */
export const INITIAL_BUCKETS = ["overdue", "today", "upcoming", "nodate", "done"] as const;
export type BoardBucket = (typeof INITIAL_BUCKETS)[number];

/** The initial entrance: reopened cards with no date column, and cards of a
 * deleted column, go to the entrance. */
export const ENTRANCE_BUCKET: BoardBucket = "nodate";

/** The buckets a column can take new tasks for, by due date. */
export type DateBucket = Exclude<BoardBucket, "done">;

/** `isDone` marks the column that holds the completed tasks (at most one);
 * `dateBucket` the column that takes the new tasks of that due-date bucket
 * (at most one per bucket). */
export type BoardColumn = {
  id: string;
  name: string;
  order: number;
  isEntrance: boolean;
  isDone: boolean;
  dateBucket: string | null;
};

/** Brazil dropped daylight saving in 2019: São Paulo is UTC-3 all year. */
const SAO_PAULO_UTC_OFFSET_HOURS = 3;

/** Start of the São Paulo calendar day containing `now`, shifted by
 * `dayOffset` days, as an absolute instant (independent of the server zone). */
export function saoPauloDayStart(now: Date, dayOffset = 0): Date {
  const local = new Date(now.getTime() - SAO_PAULO_UTC_OFFSET_HOURS * 3_600_000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset, SAO_PAULO_UTC_OFFSET_HOURS),
  );
}

/** Which initial column a task goes to when its org's board is first built:
 * the bucket the old automatic board showed it in, in São Paulo time. */
export function initialBucket(task: { doneAt: Date | null; dueDate: Date | null }, now: Date): BoardBucket {
  if (task.doneAt) return "done";
  if (!task.dueDate) return "nodate";
  const due = task.dueDate.getTime();
  if (due < saoPauloDayStart(now).getTime()) return "overdue";
  if (due < saoPauloDayStart(now, 1).getTime()) return "today";
  return "upcoming";
}

export const COLUMN_NAME_MAX = 40;

/** Column name trimmed with inner whitespace collapsed, or null when empty or
 * longer than COLUMN_NAME_MAX. */
export function normalizeColumnName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= COLUMN_NAME_MAX ? name : null;
}

/** Neighbours closer than 2 × this can't be split any more: renumber first. */
export const MIN_ORDER_GAP = 1e-6;
/** Spacing of a renumbered column (and of the board's initial numbering). */
export const ORDER_STEP = 1024;

/** boardOrder for a card inserted at `index` of a column whose OTHER cards have
 * the ascending `orders`; null when its neighbours are too close (or tied) and
 * the column must be renumbered first. */
export function orderForInsert(orders: readonly number[], index: number): number | null {
  const before = index > 0 ? orders[index - 1] : undefined;
  const after = index < orders.length ? orders[index] : undefined;
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  if (after - before < MIN_ORDER_GAP * 2) return null;
  return (before + after) / 2;
}

/** Stored position inside a column: boardOrder, then creation (oldest first),
 * then id so the order is deterministic. The screens show cards by date
 * instead (`cardOrderFor`); this only keeps new boardOrder values consistent. */
export function compareBoardCards(
  a: { boardOrder: number; createdAt: Date; id?: string },
  b: { boardOrder: number; createdAt: Date; id?: string },
): number {
  return (
    a.boardOrder - b.boardOrder ||
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
    (a.id ?? "").localeCompare(b.id ?? "")
  );
}

/** Two dates in `direction` (1 = earliest first, -1 = latest first), with
 * the missing ones always last. */
function compareDates(a: Date | null, b: Date | null, direction: 1 | -1): number {
  if (a == null || b == null) return (a == null ? 1 : 0) - (b == null ? 1 : 0);
  return direction * (new Date(a).getTime() - new Date(b).getTime());
}

/** Display order inside `column`, the same in the list tabs and on the kanban:
 * by due date, soonest first (the same day goes by the time), undated cards
 * last; the done column shows the most recently completed first. Ties go to
 * the oldest card, then to the id. Dragging a card only changes its column. */
export function cardOrderFor(column: { isDone: boolean }) {
  return (
    a: { dueDate: Date | null; doneAt: Date | null; createdAt: Date; id?: string },
    b: { dueDate: Date | null; doneAt: Date | null; createdAt: Date; id?: string },
  ): number =>
    (column.isDone ? compareDates(a.doneAt, b.doneAt, -1) : compareDates(a.dueDate, b.dueDate, 1)) ||
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
    (a.id ?? "").localeCompare(b.id ?? "");
}

/** The column a card shows in: its own, or the entrance when it has none (a
 * new task) or points at a column that no longer exists. */
export function effectiveColumnId(
  boardColumnId: string | null,
  columnIds: ReadonlySet<string>,
  entranceId: string,
): string {
  return boardColumnId && columnIds.has(boardColumnId) ? boardColumnId : entranceId;
}

/** The column that takes tasks due `dueDate`, seen from `now` (São Paulo
 * days): the one marked with that date bucket, or null when there's none. */
function columnForDate(dueDate: Date | null, now: Date, columns: readonly BoardColumn[]): string | null {
  const bucket = initialBucket({ doneAt: null, dueDate }, now);
  return columns.find((c) => !c.isDone && c.dateBucket === bucket)?.id ?? null;
}

/** Where a card goes when its task is completed (`done`) or reopened: completing
 * sends it to the done column; reopening a card that sits in the done column
 * sends it to its date's column as of `now` (the entrance when there's none).
 * `at` is only the stored boardOrder slot: the screens order by date
 * (`cardOrderFor`). null = it stays (no done column, already there, or
 * reopened outside the done column). */
export function columnForDoneChange(
  done: boolean,
  task: { boardColumnId: string | null; dueDate: Date | null },
  columns: readonly BoardColumn[],
  now: Date,
): { columnId: string; at: "start" | "end" } | null {
  const doneColumn = columns.find((c) => c.isDone);
  const entrance = columns.find((c) => c.isEntrance) ?? columns[0];
  if (!doneColumn || !entrance) return null;
  const current = effectiveColumnId(task.boardColumnId, new Set(columns.map((c) => c.id)), entrance.id);
  if (done) return current === doneColumn.id ? null : { columnId: doneColumn.id, at: "start" };
  if (current !== doneColumn.id) return null;
  const target = columnForDate(task.dueDate, now, columns) ?? entrance.id;
  return target !== doneColumn.id ? { columnId: target, at: "end" } : null;
}

/** The column a task that has none yet (just created, by any path) goes to:
 * the done column when it's done, else the column for its due date as of the
 * day it was created. null = the entrance (no such column). */
export function columnForNewTask(
  task: { doneAt: Date | null; dueDate: Date | null; createdAt: Date },
  columns: readonly BoardColumn[],
): string | null {
  if (task.doneAt) return columns.find((c) => c.isDone)?.id ?? null;
  return columnForDate(task.dueDate, new Date(task.createdAt), columns);
}

/** Where an open card goes as its due date passes or changes, seen from `now`
 * (São Paulo days): due before today, it goes to the overdue column from any
 * column but the done one — even one it was dragged to; sitting in the overdue
 * column while no longer overdue, it goes to its date's column (the entrance
 * when there's none). null = it stays (done, no overdue column, or already
 * where it belongs). */
export function columnForDeadline(
  task: { boardColumnId: string | null; dueDate: Date | null; doneAt: Date | null },
  columns: readonly BoardColumn[],
  now: Date,
): string | null {
  const overdueColumn = columns.find((c) => !c.isDone && c.dateBucket === "overdue");
  const entrance = columns.find((c) => c.isEntrance) ?? columns[0];
  if (task.doneAt || !overdueColumn || !entrance) return null;
  const current = effectiveColumnId(task.boardColumnId, new Set(columns.map((c) => c.id)), entrance.id);
  if (columns.find((c) => c.id === current)?.isDone) return null;
  const overdue = task.dueDate != null && new Date(task.dueDate).getTime() < saoPauloDayStart(now).getTime();
  if (overdue) return current === overdueColumn.id ? null : overdueColumn.id;
  if (current !== overdueColumn.id) return null;
  const target = columnForDate(task.dueDate, now, columns) ?? entrance.id;
  return target !== current ? target : null;
}

/** Whether a task is done after its card moves from column `fromColumnId` to
 * `toColumnId` (both as shown on the board): dropping it in the done column
 * completes it, taking it out of there reopens it, any other move keeps it. */
export function doneAfterMove(
  wasDone: boolean,
  fromColumnId: string,
  toColumnId: string,
  columns: readonly BoardColumn[],
): boolean {
  const doneColumn = columns.find((c) => c.isDone);
  if (!doneColumn) return wasDone;
  if (toColumnId === doneColumn.id) return true;
  if (fromColumnId === doneColumn.id) return false;
  return wasDone;
}

/** The tasks a column shows, in display order (`cardOrderFor`): the ones placed
 * in it, plus — for the entrance — the ones with no column. Used by the task
 * list's column tabs so they match the kanban. Doesn't mutate `tasks`. */
export function tasksOfColumn<
  T extends { boardColumnId: string | null; dueDate: Date | null; doneAt: Date | null; createdAt: Date; id?: string },
>(tasks: readonly T[], columnId: string, columns: readonly BoardColumn[]): T[] {
  const entrance = columns.find((c) => c.isEntrance) ?? columns[0];
  const column = columns.find((c) => c.id === columnId);
  if (!entrance || !column) return [];
  const ids = new Set(columns.map((c) => c.id));
  return tasks
    .filter((task) => effectiveColumnId(task.boardColumnId, ids, entrance.id) === columnId)
    .sort(cardOrderFor(column));
}
