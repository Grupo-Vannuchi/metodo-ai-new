/**
 * Pure rules of the task kanban (no DB, no `server-only`): the board's initial
 * placement, card ordering and column-name validation. Shared by the server
 * (src/lib/tasks/board.ts, src/app/actions/task-board.ts) and the board UI;
 * covered by `npm run check:tasks`.
 */

/** The 5 columns every org's board starts with, left to right — the old
 * automatic buckets. Names come from `tasks.board.<bucket>` of the first opener. */
export const INITIAL_BUCKETS = ["overdue", "today", "upcoming", "nodate", "done"] as const;
export type BoardBucket = (typeof INITIAL_BUCKETS)[number];

/** New tasks (no column yet) show in this one. */
export const ENTRANCE_BUCKET: BoardBucket = "nodate";

export type BoardColumn = { id: string; name: string; order: number; isEntrance: boolean };

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

/** Display order inside a column: boardOrder, then creation (oldest first),
 * then id so the order is deterministic. */
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

/** The column a card shows in: its own, or the entrance when it has none (a
 * new task) or points at a column that no longer exists. */
export function effectiveColumnId(
  boardColumnId: string | null,
  columnIds: ReadonlySet<string>,
  entranceId: string,
): string {
  return boardColumnId && columnIds.has(boardColumnId) ? boardColumnId : entranceId;
}
