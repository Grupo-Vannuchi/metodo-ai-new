/**
 * Self-check for the pure rules of the task kanban (no DB, no network, no
 * env). Run with `npm run check:tasks`; exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import {
  COLUMN_NAME_MAX,
  compareBoardCards,
  effectiveColumnId,
  ENTRANCE_BUCKET,
  INITIAL_BUCKETS,
  initialBucket,
  normalizeColumnName,
  orderForInsert,
  saoPauloDayStart,
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
  assert.equal(orderForInsert([1, 2], 1), 1.5);
});

check("compareBoardCards: boardOrder, then oldest first", () => {
  const card = (id: string, boardOrder: number, createdAt: string) => ({ id, boardOrder, createdAt: at(createdAt) });
  const sorted = [card("c", 2, "2026-01-01T00:00:00Z"), card("b", 1, "2026-01-02T00:00:00Z"), card("a", 1, "2026-01-01T00:00:00Z")]
    .sort(compareBoardCards)
    .map((c) => c.id);
  assert.deepEqual(sorted, ["a", "b", "c"]);
});

check("effectiveColumnId: the card's own column, else the entrance", () => {
  const ids = new Set(["col-a", "col-entrance"]);
  assert.equal(effectiveColumnId("col-a", ids, "col-entrance"), "col-a");
  assert.equal(effectiveColumnId(null, ids, "col-entrance"), "col-entrance");
  assert.equal(effectiveColumnId("deleted", ids, "col-entrance"), "col-entrance");
});

console.log(`\n✅ task-board: ${passed} checks passed.`);
