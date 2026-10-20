/**
 * Self-check for the pure rules of the task kanban (no DB, no network, no
 * env). Run with `npm run check:tasks`; exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import {
  cardOrderFor,
  COLUMN_NAME_MAX,
  columnForDeadline,
  columnForDoneChange,
  columnForNewTask,
  compareBoardCards,
  doneAfterMove,
  effectiveColumnId,
  ENTRANCE_BUCKET,
  INITIAL_BUCKETS,
  initialBucket,
  normalizeColumnName,
  orderForInsert,
  saoPauloDayStart,
  tasksOfColumn,
} from "../src/lib/tasks/board-core";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const at = (iso: string) => new Date(iso);

check("the board starts with the 5 old columns, entrance on 'Sem data'", () => {
  assert.deepEqual([...INITIAL_BUCKETS], ["overdue", "today", "upcoming", "nodate", "done"]);
  assert.equal(ENTRANCE_BUCKET, "nodate");
});

check("saoPauloDayStart is São Paulo midnight (UTC-3) whatever the server's zone", () => {
  // 23:59:59 on Oct 7 in São Paulo is already 02:59:59Z on Oct 8.
  assert.equal(saoPauloDayStart(at("2026-10-08T02:59:59Z")).toISOString(), "2026-10-07T03:00:00.000Z");
  assert.equal(saoPauloDayStart(at("2026-10-08T03:00:00Z")).toISOString(), "2026-10-08T03:00:00.000Z");
  assert.equal(saoPauloDayStart(at("2026-10-08T03:00:00Z"), 1).toISOString(), "2026-10-09T03:00:00.000Z");
  assert.equal(saoPauloDayStart(at("2026-12-31T23:00:00Z"), 1).toISOString(), "2027-01-01T03:00:00.000Z");
});

check("initialBucket: done wins, then no date, then São Paulo day boundaries", () => {
  const now = at("2026-10-08T02:30:00Z"); // 23:30 on Oct 7 in São Paulo, Oct 8 in UTC
  const task = (dueDate: string | null, doneAt: string | null = null) => ({
    dueDate: dueDate ? at(dueDate) : null,
    doneAt: doneAt ? at(doneAt) : null,
  });
  assert.equal(initialBucket(task("2026-10-01T12:00:00Z", "2026-10-02T12:00:00Z"), now), "done");
  assert.equal(initialBucket(task(null, "2026-10-02T12:00:00Z"), now), "done");
  assert.equal(initialBucket(task(null), now), "nodate");
  assert.equal(initialBucket(task("2026-10-07T02:59:59Z"), now), "overdue"); // 23:59:59 Oct 6 SP
  assert.equal(initialBucket(task("2026-10-07T03:00:00Z"), now), "today"); // 00:00 Oct 7 SP
  assert.equal(initialBucket(task("2026-10-08T02:59:00Z"), now), "today"); // 23:59 Oct 7 SP
  assert.equal(initialBucket(task("2026-10-08T03:00:00Z"), now), "upcoming"); // 00:00 Oct 8 SP
});

check("normalizeColumnName trims, collapses spaces and enforces 1..40", () => {
  assert.equal(normalizeColumnName("  Esta   semana "), "Esta semana");
  assert.equal(normalizeColumnName("   "), null);
  assert.equal(normalizeColumnName("x".repeat(COLUMN_NAME_MAX)), "x".repeat(40));
  assert.equal(normalizeColumnName("x".repeat(COLUMN_NAME_MAX + 1)), null);
});

check("orderForInsert: empty column, top, end, middle", () => {
  assert.equal(orderForInsert([], 0), 0);
  assert.equal(orderForInsert([1024, 2048], 0), 1023);
  assert.equal(orderForInsert([1024, 2048], 2), 2049);
  assert.equal(orderForInsert([1024, 2048], 1), 1536);
});

check("orderForInsert asks for a renumber when neighbours tie or are too close", () => {
  assert.equal(orderForInsert([5, 5], 1), null);
  assert.equal(orderForInsert([1, 1 + 1e-6], 1), null);
  assert.notEqual(orderForInsert([1, 1 + 3e-6], 1), null);
  assert.equal(orderForInsert([1, 2], 1), 1.5);
});

check("compareBoardCards: boardOrder, then oldest first", () => {
  const card = (id: string, boardOrder: number, createdAt: string) => ({ id, boardOrder, createdAt: at(createdAt) });
  const sorted = [card("c", 2, "2026-01-01T00:00:00Z"), card("b", 1, "2026-01-02T00:00:00Z"), card("a", 1, "2026-01-01T00:00:00Z")]
    .sort(compareBoardCards)
    .map((c) => c.id);
  assert.deepEqual(sorted, ["a", "b", "c"]);
  // Ties on both boardOrder and createdAt fall back to the id.
  const tied = [card("b2", 1, "2026-01-01T00:00:00Z"), card("b1", 1, "2026-01-01T00:00:00Z")]
    .sort(compareBoardCards)
    .map((c) => c.id);
  assert.deepEqual(tied, ["b1", "b2"]);
});

check("effectiveColumnId: the card's own column, else the entrance", () => {
  const ids = new Set(["col-a", "col-entrance"]);
  assert.equal(effectiveColumnId("col-a", ids, "col-entrance"), "col-a");
  assert.equal(effectiveColumnId(null, ids, "col-entrance"), "col-entrance");
  assert.equal(effectiveColumnId("deleted", ids, "col-entrance"), "col-entrance");
});

check("cardOrderFor: by due date, soonest first; same day by the time; undated last", () => {
  const card = (id: string, dueDate: string | null, createdAt = "2026-01-01T00:00:00Z") => ({
    id,
    dueDate: dueDate ? at(dueDate) : null,
    doneAt: null,
    createdAt: at(createdAt),
  });
  const cards = [
    card("21 Oct", "2026-10-21T13:00:00Z"),
    card("no date", null),
    card("20 Oct 14h", "2026-10-20T17:00:00Z"),
    card("20 Oct 09h", "2026-10-20T12:00:00Z"),
  ];
  assert.deepEqual(
    [...cards].sort(cardOrderFor({ isDone: false })).map((x) => x.id),
    ["20 Oct 09h", "20 Oct 14h", "21 Oct", "no date"],
  );
  // Same due date (or none): the oldest card first, then the id.
  const ties = [
    card("b", "2026-10-20T12:00:00Z", "2026-01-02T00:00:00Z"),
    card("z", null, "2026-01-01T00:00:00Z"),
    card("c", "2026-10-20T12:00:00Z", "2026-01-01T00:00:00Z"),
    card("a", "2026-10-20T12:00:00Z", "2026-01-01T00:00:00Z"),
    card("y", null, "2026-01-03T00:00:00Z"),
  ];
  assert.deepEqual([...ties].sort(cardOrderFor({ isDone: false })).map((x) => x.id), ["a", "c", "b", "z", "y"]);
});

check("cardOrderFor: the done column shows the most recently completed first", () => {
  const card = (id: string, doneAt: string | null, dueDate: string | null) => ({
    id,
    dueDate: dueDate ? at(dueDate) : null,
    doneAt: doneAt ? at(doneAt) : null,
    createdAt: at("2026-01-01T00:00:00Z"),
  });
  const cards = [
    card("done 18", "2026-10-18T12:00:00Z", "2026-10-01T12:00:00Z"),
    card("open", null, "2026-09-01T12:00:00Z"),
    card("done 20", "2026-10-20T12:00:00Z", "2026-12-01T12:00:00Z"),
    card("done 19", "2026-10-19T12:00:00Z", null),
  ];
  assert.deepEqual(
    [...cards].sort(cardOrderFor({ isDone: true })).map((x) => x.id),
    ["done 20", "done 19", "done 18", "open"],
  );
});

check("tasksOfColumn: a column's cards in display order; the entrance also takes unplaced ones", () => {
  const cols = [
    { id: "a", name: "A", order: 0, isEntrance: false, isDone: false, dateBucket: null },
    { id: "e", name: "E", order: 1, isEntrance: true, isDone: false, dateBucket: null },
    { id: "d", name: "D", order: 2, isEntrance: false, isDone: true, dateBucket: null },
  ];
  const task = (id: string, boardColumnId: string | null, dueDate: string | null, doneAt: string | null = null) => ({
    id,
    boardColumnId,
    dueDate: dueDate ? at(dueDate) : null,
    doneAt: doneAt ? at(doneAt) : null,
    createdAt: at("2026-01-01T00:00:00Z"),
  });
  const tasks = [
    task("1", "a", "2026-10-21T12:00:00Z"),
    task("2", null, null),
    task("3", "a", "2026-10-20T12:00:00Z"),
    task("4", "gone", "2026-10-25T12:00:00Z"),
    task("5", "e", "2026-10-22T12:00:00Z"),
    task("6", "d", "2026-10-01T12:00:00Z", "2026-10-10T12:00:00Z"),
    task("7", "d", "2026-10-30T12:00:00Z", "2026-10-15T12:00:00Z"),
  ];
  assert.deepEqual(tasksOfColumn(tasks, "a", cols).map((x) => x.id), ["3", "1"]);
  assert.deepEqual(tasksOfColumn(tasks, "e", cols).map((x) => x.id), ["5", "4", "2"]);
  assert.deepEqual(tasksOfColumn(tasks, "d", cols).map((x) => x.id), ["7", "6"]);
  assert.deepEqual(tasksOfColumn(tasks, "a", []), []);
  assert.deepEqual(tasksOfColumn(tasks, "unknown", cols), []);
  assert.deepEqual(tasks.map((x) => x.id), ["1", "2", "3", "4", "5", "6", "7"]); // input left untouched
});

const board = [
  { id: "late", name: "Atrasadas", order: 0, isEntrance: false, isDone: false, dateBucket: "overdue" },
  { id: "today", name: "Hoje", order: 1, isEntrance: false, isDone: false, dateBucket: "today" },
  { id: "soon", name: "Em breve", order: 2, isEntrance: false, isDone: false, dateBucket: "upcoming" },
  { id: "nodate", name: "Sem data", order: 3, isEntrance: true, isDone: false, dateBucket: "nodate" },
  { id: "done", name: "Concluídas", order: 4, isEntrance: false, isDone: true, dateBucket: null },
];
const withoutDone = board.map((c) => ({ ...c, isDone: false }));
const withoutToday = board.filter((c) => c.id !== "today");
// Noon of Oct 14 in São Paulo (UTC-3).
const now = at("2026-10-14T15:00:00Z");
const DUE = {
  yesterday: at("2026-10-13T20:00:00Z"),
  today: at("2026-10-14T20:00:00Z"),
  lateToday: at("2026-10-15T02:00:00Z"), // 23:00 of Oct 14 in São Paulo
  later: at("2026-10-20T12:00:00Z"),
};
const card = (boardColumnId: string | null, dueDate: Date | null = null) => ({ boardColumnId, dueDate });

check("columnForDoneChange: completing sends the card to the top of the done column", () => {
  assert.deepEqual(columnForDoneChange(true, card("late"), board, now), { columnId: "done", at: "start" });
  assert.deepEqual(columnForDoneChange(true, card(null), board, now), { columnId: "done", at: "start" });
  assert.deepEqual(columnForDoneChange(true, card("gone"), board, now), { columnId: "done", at: "start" });
  assert.equal(columnForDoneChange(true, card("done"), board, now), null); // already there
});

check("columnForDoneChange: reopening leaves the done column for its date's column, at the end", () => {
  assert.deepEqual(columnForDoneChange(false, card("done", DUE.yesterday), board, now), { columnId: "late", at: "end" });
  assert.deepEqual(columnForDoneChange(false, card("done", DUE.today), board, now), { columnId: "today", at: "end" });
  assert.deepEqual(columnForDoneChange(false, card("done", DUE.lateToday), board, now), { columnId: "today", at: "end" });
  assert.deepEqual(columnForDoneChange(false, card("done", DUE.later), board, now), { columnId: "soon", at: "end" });
  assert.deepEqual(columnForDoneChange(false, card("done"), board, now), { columnId: "nodate", at: "end" });
  // That date's column was deleted: the entrance.
  assert.deepEqual(columnForDoneChange(false, card("done", DUE.today), withoutToday, now), { columnId: "nodate", at: "end" });
  assert.equal(columnForDoneChange(false, card("late", DUE.today), board, now), null); // reopened elsewhere: stays
  assert.equal(columnForDoneChange(false, card(null), board, now), null);
});

check("columnForDoneChange: no board or no done column means the card stays", () => {
  assert.equal(columnForDoneChange(true, card("late"), [], now), null);
  assert.equal(columnForDoneChange(true, card("late"), withoutDone, now), null);
  assert.equal(columnForDoneChange(false, card("done"), withoutDone, now), null);
});

check("columnForNewTask: by due date against the day the task was created", () => {
  const task = (dueDate: Date | null, createdAt = now, doneAt: Date | null = null) => ({ dueDate, createdAt, doneAt });
  assert.equal(columnForNewTask(task(DUE.yesterday), board), "late");
  assert.equal(columnForNewTask(task(DUE.today), board), "today");
  assert.equal(columnForNewTask(task(DUE.lateToday), board), "today");
  assert.equal(columnForNewTask(task(DUE.later), board), "soon");
  assert.equal(columnForNewTask(task(null), board), "nodate");
  // Created on Oct 10, due Oct 14: it was "upcoming" when created.
  assert.equal(columnForNewTask(task(DUE.today, at("2026-10-10T15:00:00Z")), board), "soon");
  assert.equal(columnForNewTask(task(DUE.today, now, now), board), "done"); // created already done
  assert.equal(columnForNewTask(task(DUE.today), withoutToday), null); // no such column: the entrance
  assert.equal(columnForNewTask(task(null), []), null);
});

check("doneAfterMove: dropping in the done column completes, taking it out reopens", () => {
  assert.equal(doneAfterMove(false, "late", "done", board), true);
  assert.equal(doneAfterMove(true, "done", "late", board), false);
  assert.equal(doneAfterMove(true, "done", "nodate", board), false);
  assert.equal(doneAfterMove(true, "done", "done", board), true); // reordered inside
  assert.equal(doneAfterMove(false, "late", "nodate", board), false);
  assert.equal(doneAfterMove(true, "late", "nodate", board), true); // done outside the done column stays done
  assert.equal(doneAfterMove(false, "late", "done", withoutDone), false);
});

const deadlineTask = (boardColumnId: string | null, dueDate: Date | null, doneAt: Date | null = null) => ({
  boardColumnId,
  dueDate,
  doneAt,
});

check("columnForDeadline: an open task due before today goes to the overdue column from any column", () => {
  const withCustom = [...board, { id: "mine", name: "Aguardando cliente", order: 5, isEntrance: false, isDone: false, dateBucket: null }];
  assert.equal(columnForDeadline(deadlineTask("today", DUE.yesterday), board, now), "late");
  assert.equal(columnForDeadline(deadlineTask("soon", DUE.yesterday), board, now), "late");
  assert.equal(columnForDeadline(deadlineTask("nodate", DUE.yesterday), board, now), "late");
  assert.equal(columnForDeadline(deadlineTask("mine", DUE.yesterday), withCustom, now), "late"); // a column the company created
  assert.equal(columnForDeadline(deadlineTask(null, DUE.yesterday), board, now), "late"); // not placed yet
  assert.equal(columnForDeadline(deadlineTask("gone", DUE.yesterday), board, now), "late"); // its column was deleted
  assert.equal(columnForDeadline(deadlineTask("late", DUE.yesterday), board, now), null); // already there
});

check("columnForDeadline: overdue starts at São Paulo's midnight; a task due today stays", () => {
  assert.equal(columnForDeadline(deadlineTask("today", at("2026-10-14T02:59:59Z")), board, now), "late"); // 23:59:59 of Oct 13 SP
  assert.equal(columnForDeadline(deadlineTask("today", at("2026-10-14T03:00:00Z")), board, now), null); // 00:00 of Oct 14 SP
  // 23:30 of Oct 14 in São Paulo, already Oct 15 in UTC: due 17:00 of Oct 14 isn't overdue yet.
  assert.equal(columnForDeadline(deadlineTask("today", DUE.today), board, at("2026-10-15T02:30:00Z")), null);
  assert.equal(columnForDeadline(deadlineTask("today", DUE.today), board, at("2026-10-15T03:00:00Z")), "late");
});

check("columnForDeadline: done tasks and the done column are left alone; no overdue column, nothing moves", () => {
  assert.equal(columnForDeadline(deadlineTask("done", DUE.yesterday, now), board, now), null);
  assert.equal(columnForDeadline(deadlineTask("today", DUE.yesterday, now), board, now), null); // done outside the done column
  assert.equal(columnForDeadline(deadlineTask("late", DUE.later, now), board, now), null); // done, in the overdue column
  assert.equal(columnForDeadline(deadlineTask("done", DUE.yesterday), board, now), null); // open card in the done column
  const withoutLate = board.filter((c) => c.id !== "late");
  assert.equal(columnForDeadline(deadlineTask("today", DUE.yesterday), withoutLate, now), null);
  assert.equal(columnForDeadline(deadlineTask("today", DUE.yesterday), [], now), null);
});

check("columnForDeadline: a card in the overdue column that isn't overdue goes to its date's column", () => {
  assert.equal(columnForDeadline(deadlineTask("late", DUE.today), board, now), "today");
  assert.equal(columnForDeadline(deadlineTask("late", DUE.lateToday), board, now), "today");
  assert.equal(columnForDeadline(deadlineTask("late", DUE.later), board, now), "soon");
  assert.equal(columnForDeadline(deadlineTask("late", null), board, now), "nodate");
  assert.equal(columnForDeadline(deadlineTask("late", DUE.today), withoutToday, now), "nodate"); // no such column: the entrance
  // The overdue column is the entrance and there's no column for the date: it stays.
  const lateEntrance = withoutToday.map((c) => ({ ...c, isEntrance: c.id === "late" }));
  assert.equal(columnForDeadline(deadlineTask("late", DUE.today), lateEntrance, now), null);
  assert.equal(columnForDeadline(deadlineTask(null, DUE.today), lateEntrance, now), null);
});

console.log(`\n✅ task-board: ${passed} checks passed.`);
