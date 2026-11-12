# Kanban de Tarefas com colunas livres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Tasks kanban (`/app/tasks?view=kanban`) into a Trello-style board. Each org gets free columns its members can rename, create, reorder and delete; cards move freely between and within columns; the horizontal scrollbar is visible.

**Architecture:**
- **Data:** a new tenant table `task_board_columns`, plus two new `tasks` columns: `boardColumnId`, where null means the entrance column, and `boardOrder`, whose DB default is the creation instant.
- **No changes to the task-creating code paths:** a new task has no column, so it shows in the entrance; and the default `boardOrder` puts it at the end.
- **Board built on first open:** `ensureTaskBoard` creates each org's board the first time someone opens the kanban. It places every existing task where the old automatic board showed it (São Paulo time), under a per-org advisory lock.
- **Code layout:**
  - pure rules live in `src/lib/tasks/board-core.ts`, checked by `npm run check:tasks`;
  - server actions live in `src/app/actions/task-board.ts`;
  - the UI is split into board, column and card components.

**Tech Stack:** Next.js 16 (App Router, server actions), Prisma 6 + PostgreSQL (Docker locally, Supabase in prod), next-intl 4, Tailwind, native HTML5 drag-and-drop, tsx for check scripts.

**Spec:** [docs/superpowers/specs/2026-10-08-tarefas-kanban-colunas-design.md](../specs/2026-10-08-tarefas-kanban-colunas-design.md)

## Global Constraints

- **Columns:**
  - Board start: the columns Atrasadas, Hoje, Em breve, **Sem data (★ entrance)** and Concluídas, named from the opener's `tasks.board.<bucket>` messages.
  - Initial placement uses `America/Sao_Paulo`, which is fixed at UTC-3.
  - Column names are 1–40 chars, trimmed, with inner whitespace collapsed.
  - Max **20** columns per org (`LIMITS.taskBoardColumnsMax`).
  - The entrance column can't be deleted. Deleting another column moves its cards to the entrance (`boardColumnId = null`).
  - Changing the entrance first writes the old entrance id on every task with `boardColumnId = null`.
- **Completion:** columns are **independent** of completion. Dragging into "Concluídas" no longer completes a task; the check never moves a card. The "Atrasadas" title is no longer red; a card's date stays red when it is before today's start and the task is open.
- **Card order:**
  - `boardOrder` ascending, ties by `createdAt` ascending.
  - Insert = midpoint of neighbours; top = first − 1; end = last + 1; empty = 0.
  - Renumber the column to 1024, 2048, … when the neighbours are < 2e-6 apart.
  - Initial numbering is per column by `dueDate ASC NULLS LAST, createdAt ASC` × 1024.
- **Multi-tenant (guide 03):**
  - user requests use `tenantDb(orgId)`;
  - by-id work is `findFirst` + `updateMany`/`deleteMany` with a `count` check;
  - never `findUnique`/`update`/`delete`/`upsert` on business tables;
  - inside `$transaction` callbacks, also write `organizationId` explicitly in every `where`;
  - raw SQL always filters `organizationId` explicitly.
  - `TaskBoardColumn` goes into `TENANT_MODELS`.
- **Gating:** every new server action checks the session, `canAccessScreen(ctx, "tasks")` and `hasModule(ctx.modules, "tasks")`.
- **Local DB:** the local DB is **Docker** (`docker compose up -d postgres`, container `metodoai-db`). Never the portable Postgres. **Never** `prisma migrate dev`/`migrate reset`/`db push`.
- **i18n:** `pt.json`/`en.json` keep identical keys and no `{{`. The leaf count goes 2788 → **2803**; update it in `CLAUDE.md` and `docs/guia/04-modulos-e-permissoes.md`.
- **Env:** only via `src/lib/env.ts`; this plan adds none.
- **Out of scope:**
  - the list view, which keeps its date tabs;
  - the CRM board (`src/app/[locale]/app/crm/**`, `src/components/crm/**`) — don't touch it, even though its page has the same height calc;
  - Campaigns.
- **Commits:** `[Tarefas] - Verbo + tarefa`, short body, last line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feature/tarefas-kanban-colunas`. No push.
- **Code style:** code comments in English; docs and UI texts in pt-BR (en.json in English).
- **Build:** stop any `next dev` before `npm run build`. If the dev server misbehaves, use `npx next dev --webpack`.

## Review Focus

1. **Two members open the kanban for the first time at the same moment** → exactly 5 columns, not 10. Covered by the advisory lock + re-count inside `ensureTaskBoard` (Task 3) and the two-tab QA step (Task 5).
2. **A task due at 23:30 in São Paulo, on the day of first open, with the server in UTC (already the next day there)** → it lands in "Hoje", not "Em breve" or "Atrasadas". Covered by `check:tasks` boundary cases (Task 2).
3. **A card dropped back exactly where it was** → no request, no reorder. Covered by the early return in `onDropColumn` (Task 4) and QA (Task 5).
4. **Deleting a column with cards** → the cards reappear in the entrance column and nothing is lost. Deleting the entrance is impossible: the menu item is disabled and the action answers `entrance`. Covered by Task 3 (action), Task 4 (menu) and Task 5 (QA).
5. **Several cards with the same `boardOrder`** (every pre-existing row gets the migration instant) → a stable order by creation, and dropping between two tied cards still works. Covered by the `orderForInsert` tie test (Task 2) and the renumber path in `moveTaskOnBoard` (Task 3).

---

### Task 1: Banco (colunas do quadro e posição do card)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261008150000_task_board_columns/migration.sql` (gerado)
- Modify: `src/lib/tenant-db.ts` (`TENANT_MODELS`)
- Modify: `scripts/check-isolation.ts`
- Modify: `docs/guia/03-multi-tenancy.md`

**Interfaces:**
- Produces: Prisma model `taskBoardColumn` (`id`, `organizationId`, `name`, `order`, `isEntrance`, `createdAt`, `updatedAt`); `task.boardColumnId: string | null`; `task.boardOrder: number` (DB default = epoch seconds of the insert).

- [ ] **Step 1: Docker DB up**

Run `docker ps --format '{{.Names}} {{.Status}}'`; expect `metodoai-db` `(healthy)`. If the daemon isn't up, start `%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`, wait for `docker info`, then `docker compose up -d postgres`. If `%LOCALAPPDATA%\metodoai-dev\pg.cmd status` shows the portable Postgres running, `pg.cmd stop`.

- [ ] **Step 2: Failing test (isolation)**

In `scripts/check-isolation.ts`, right before `console.log("\n✅ Tenant isolation: all checks passed.");`:

```ts
    // 12) Task board columns are per org.
    await prisma.taskBoardColumn.create({
      data: { organizationId: orgA.id, name: "ISO", order: 0, isEntrance: true },
    });
    const columnsB = await prisma.taskBoardColumn.findMany({
      where: { organizationId: orgB.id },
    });
    assert(columnsB.length === 0, "task board columns scoped to org B exclude org A's column");
```

In the `finally`, as the FIRST cleanup statement (before `await prisma.emailSenderDomain.deleteMany(...)`):

```ts
    await prisma.taskBoardColumn.deleteMany({
      where: { organizationId: { in: created.orgs } },
    });
```

Run `npm run typecheck` → FAIL: `Property 'taskBoardColumn' does not exist`.

- [ ] **Step 3: Schema**

In `model Task`, right after `doneAt         DateTime?`:

```prisma
  /// Kanban column; null = the org's entrance column (TaskBoardColumn.isEntrance).
  boardColumnId  String?
  /// Position inside the kanban column (ascending). Defaults to the insert
  /// instant (epoch seconds), so a new task lands at the end of the entrance
  /// column without the task-creating code paths knowing about the board.
  boardOrder     Float          @default(dbgenerated("extract(epoch from now())"))
```

In `model Task`, after `attachments TaskAttachment[]`:

```prisma
  boardColumn TaskBoardColumn? @relation(fields: [boardColumnId], references: [id], onDelete: SetNull)
```

In `model Task`, next to the other `@@index` lines:

```prisma
  @@index([organizationId, boardColumnId])
```

After the whole `model Task { ... }` block:

```prisma
/// A column of the org's task kanban (one board per org). Built on the board's
/// first open (src/lib/tasks/board.ts); renamed/added/removed by members.
/// Columns don't mean anything to the task (completion is the check).
model TaskBoardColumn {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  order          Int      @default(0)
  /// New tasks (boardColumnId null) show here. Exactly one per org.
  isEntrance     Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tasks Task[]

  @@index([organizationId, order])
  @@map("task_board_columns")
}
```

- [ ] **Step 4: Generate and apply the migration (no `migrate dev`)**

```bash
mkdir -p prisma/migrations/20261008150000_task_board_columns
git show origin/main:prisma/schema.prisma > "$TEMP/schema-main.prisma"
npx prisma migrate diff --from-schema-datamodel "$TEMP/schema-main.prisma" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261008150000_task_board_columns/migration.sql
```

(If `$TEMP` is empty in Git Bash, use the session scratchpad dir instead.)

Open the SQL. It must contain ONLY these statements; anything else → stop and report:
- `ALTER TABLE "tasks" ADD COLUMN "boardColumnId" TEXT, ADD COLUMN "boardOrder" DOUBLE PRECISION NOT NULL DEFAULT extract(epoch from now())` (one or two ALTERs);
- `CREATE TABLE "task_board_columns"`;
- `CREATE INDEX` on `task_board_columns("organizationId", "order")`;
- `CREATE INDEX` on `tasks("organizationId", "boardColumnId")`;
- `ALTER TABLE "tasks" ADD CONSTRAINT "tasks_boardColumnId_fkey" ... ON DELETE SET NULL ON UPDATE CASCADE`.

Then:

```bash
npx prisma db execute --file prisma/migrations/20261008150000_task_board_columns/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20261008150000_task_board_columns
npx prisma generate
```

In `src/lib/tenant-db.ts`, add `"TaskBoardColumn",` to `TENANT_MODELS` right after `"TaskChecklistItem",`.

- [ ] **Step 5: Run and confirm it passes**

Run: `npm run typecheck && npm run check:isolation`
Expected: PASS, ending `✅ Tenant isolation: all checks passed.`, listing the new assertion.

Also confirm the default works on the Docker DB:

```bash
node --env-file=.env -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(async()=>{const r=await c.query('select count(*)::int n, count(distinct \"boardOrder\")::int d, min(\"boardOrder\") mn from tasks');console.log(r.rows[0]);await c.end()})"
```

Expected: every row has a `boardOrder` (≈ 1.79e9, the migration instant; `d` may be 1). That is fine: the board build renumbers them.

- [ ] **Step 6: Guide 03**

In `docs/guia/03-multi-tenancy.md`:
- `TENANT_MODELS` count: 75 → **76**;
- assertion count: 14 → **15** (verify with `grep -c "    assert(" scripts/check-isolation.ts`);
- add "coluna do quadro de tarefas" to the list of what the script populates.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261008150000_task_board_columns src/lib/tenant-db.ts scripts/check-isolation.ts docs/guia/03-multi-tenancy.md
git commit -m "[Tarefas] - Adiciona as colunas do quadro e a posicao do card" -m "Migration aditiva: task_board_columns e, em tasks, boardColumnId (nula = entrada) e boardOrder (padrao = instante da criacao); isolamento coberto." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regras puras do quadro + `npm run check:tasks`

**Files:**
- Create: `src/lib/tasks/board-core.ts`
- Create: `scripts/check-task-board.ts`
- Modify: `package.json` (script `check:tasks`)
- Modify: `docs/guia/06-antes-de-commitar.md`

**Interfaces:**
- Produces (all exported from `@/lib/tasks/board-core`; pure, no `server-only`, client-safe):
  - `INITIAL_BUCKETS: readonly ["overdue","today","upcoming","nodate","done"]`, `type BoardBucket`, `ENTRANCE_BUCKET: BoardBucket` (= `"nodate"`);
  - `type BoardColumn = { id: string; name: string; order: number; isEntrance: boolean }`;
  - `saoPauloDayStart(now: Date, dayOffset?: number): Date`;
  - `initialBucket(task: { doneAt: Date | null; dueDate: Date | null }, now: Date): BoardBucket`;
  - `COLUMN_NAME_MAX = 40`, `normalizeColumnName(raw: string): string | null`;
  - `MIN_ORDER_GAP = 1e-6`, `ORDER_STEP = 1024`, `orderForInsert(orders: readonly number[], index: number): number | null`;
  - `compareBoardCards(a: { boardOrder: number; createdAt: Date }, b: same): number`;
  - `effectiveColumnId(boardColumnId: string | null, columnIds: ReadonlySet<string>, entranceId: string): string`.

- [ ] **Step 1: Write the failing test** — `scripts/check-task-board.ts`:

```ts
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
```

In `package.json` `scripts`, after `"check:email"`: `"check:tasks": "tsx scripts/check-task-board.ts",`

- [ ] **Step 2: Run, confirm it fails**

Run: `npm run check:tasks` → FAIL `Cannot find module '../src/lib/tasks/board-core'`.

- [ ] **Step 3: Implement `src/lib/tasks/board-core.ts`**

```ts
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

/** Display order inside a column: boardOrder, then creation (oldest first). */
export function compareBoardCards(
  a: { boardOrder: number; createdAt: Date },
  b: { boardOrder: number; createdAt: Date },
): number {
  return a.boardOrder - b.boardOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
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
```

- [ ] **Step 4: Run, confirm it passes**

Run: `npm run check:tasks && npm run typecheck` → PASS, `✅ task-board: 8 checks passed.`

- [ ] **Step 5: Guide 06**

In `docs/guia/06-antes-de-commitar.md`, right after the paragraph "**Checagem de módulo (fora das cinco):** `npm run check:email` …", add:

```markdown
`npm run check:tasks` faz o mesmo para as regras puras do kanban de Tarefas
([src/lib/tasks/board-core.ts](../../src/lib/tasks/board-core.ts): distribuição inicial por data no
horário de Brasília, posição entre cards, nome de coluna). Rode sempre que mexer nesse arquivo.
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/tasks/board-core.ts scripts/check-task-board.ts package.json docs/guia/06-antes-de-commitar.md
git commit -m "[Tarefas] - Adiciona as regras puras do quadro e o check:tasks" -m "Distribuicao inicial no horario de Brasilia, posicao entre cards e validacao do nome da coluna." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Servidor (montagem do quadro, leitura, actions, tempo real)

**Files:**
- Modify: `src/config/limits.ts`
- Create: `src/lib/tasks/board.ts`
- Create: `src/lib/queries/task-board.ts`
- Create: `src/app/actions/task-board.ts`
- Modify: `src/lib/queries/tasks.ts` (`TaskRow` + select)
- Modify: `src/lib/queries/realtime.ts`
- Modify: `docs/guia/04-modulos-e-permissoes.md` (limits paragraph)

**Interfaces:**
- Consumes: Task 1 models; Task 2 `INITIAL_BUCKETS`, `ENTRANCE_BUCKET`, `BoardBucket`, `BoardColumn`, `initialBucket`, `normalizeColumnName`, `orderForInsert`, `compareBoardCards`, `ORDER_STEP`.
- Produces:
  - `LIMITS.taskBoardColumnsMax: number` (= 20);
  - `ensureTaskBoard(organizationId: string, names: Record<BoardBucket, string>): Promise<void>` (`@/lib/tasks/board`);
  - `listTaskBoardColumns(organizationId: string): Promise<BoardColumn[]>` (`@/lib/queries/task-board`);
  - `TaskRow` gains `boardColumnId: string | null; boardOrder: number; createdAt: Date`;
  - actions in `@/app/actions/task-board`:
    - `moveTaskOnBoard(taskId, columnId, beforeTaskId: string | null)`;
    - `createTaskBoardColumn(name)`, `renameTaskBoardColumn(id, name)`;
    - `moveTaskBoardColumn(id, "left" | "right")`;
    - `setTaskBoardEntrance(id)`, `deleteTaskBoardColumn(id)`;
    - all return `Promise<TaskBoardResult>`, where `TaskBoardResult = { ok: true } | { ok: false; error: TaskBoardError }` and `TaskBoardError = "unauthorized" | "forbidden" | "invalid" | "not_found" | "limit" | "entrance" | "unknown"`.

- [ ] **Step 1: Limit**

In `src/config/limits.ts`, add to the type (after `companiesPerAccount: number;`):

```ts
  /** Columns of the Tasks kanban per org. */
  taskBoardColumnsMax: number;
```

and to the value (after `companiesPerAccount: 5,`): `taskBoardColumnsMax: 20,`

In `docs/guia/04-modulos-e-permissoes.md`, in the limits paragraph (the list of fields), add `taskBoardColumnsMax` (20) next to `companiesPerAccount` (5).

- [ ] **Step 2: `src/lib/tasks/board.ts`**

```ts
import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { ENTRANCE_BUCKET, INITIAL_BUCKETS, initialBucket, ORDER_STEP, type BoardBucket } from "@/lib/tasks/board-core";

/**
 * Builds the org's task board on its first open: the 5 initial columns, every
 * existing task placed where the old automatic board showed it (São Paulo
 * time), and each column numbered by due date. Idempotent and race-safe: a
 * per-org transaction lock + re-count means two simultaneous first opens
 * create ONE board. Called by the kanban page before it lists anything.
 */
export async function ensureTaskBoard(organizationId: string, names: Record<BoardBucket, string>): Promise<void> {
  const db = tenantDb(organizationId);
  if ((await db.taskBoardColumn.count()) > 0) return;

  await db.$transaction(
    async (tx) => {
      // Released at commit/rollback. `SELECT 1 FROM` avoids returning a void column.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`task_board:${organizationId}`}))`;
      if ((await tx.taskBoardColumn.count({ where: { organizationId } })) > 0) return;

      const idByBucket = {} as Record<BoardBucket, string>;
      for (const [order, bucket] of INITIAL_BUCKETS.entries()) {
        const column = await tx.taskBoardColumn.create({
          data: { organizationId, name: names[bucket], order, isEntrance: bucket === ENTRANCE_BUCKET },
          select: { id: true },
        });
        idByBucket[bucket] = column.id;
      }

      const now = new Date();
      const tasks = await tx.task.findMany({
        where: { organizationId },
        select: { id: true, doneAt: true, dueDate: true },
      });
      const idsByBucket = new Map<BoardBucket, string[]>();
      for (const task of tasks) {
        const bucket = initialBucket(task, now);
        if (bucket === ENTRANCE_BUCKET) continue; // no column = the entrance
        idsByBucket.set(bucket, [...(idsByBucket.get(bucket) ?? []), task.id]);
      }
      for (const [bucket, ids] of idsByBucket) {
        await tx.task.updateMany({
          where: { organizationId, id: { in: ids } },
          data: { boardColumnId: idByBucket[bucket] },
        });
      }

      // Number each column by due date (no date last), then creation. Raw SQL
      // is not intercepted by tenantDb: organizationId is filtered explicitly.
      await tx.$executeRaw`
        UPDATE "tasks" AS t SET "boardOrder" = s.rn * ${ORDER_STEP}
        FROM (
          SELECT "id", row_number() OVER (
            PARTITION BY "boardColumnId" ORDER BY "dueDate" ASC NULLS LAST, "createdAt" ASC
          ) AS rn
          FROM "tasks" WHERE "organizationId" = ${organizationId}
        ) AS s
        WHERE t."id" = s."id" AND t."organizationId" = ${organizationId}`;
    },
    { timeout: 20_000 },
  );
}
```

- [ ] **Step 3: DAL `src/lib/queries/task-board.ts`**

```ts
import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import type { BoardColumn } from "@/lib/tasks/board-core";

/** The org's kanban columns, left to right. */
export async function listTaskBoardColumns(organizationId: string): Promise<BoardColumn[]> {
  return tenantDb(organizationId).taskBoardColumn.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, order: true, isEntrance: true },
  });
}
```

- [ ] **Step 4: `TaskRow`** (`src/lib/queries/tasks.ts`)

In `export type TaskRow`, after `attachmentCount: number;`:

```ts
  /** Kanban column (null = the entrance) and position inside it. */
  boardColumnId: string | null;
  boardOrder: number;
  createdAt: Date;
```

In `listTasks`' `select`, after `opportunityId: true,`: `boardColumnId: true, boardOrder: true, createdAt: true,`

Run `npm run typecheck`. If any other place builds a `TaskRow` literal, add the three fields there (expected: none — the hub components only consume `listTasks` results).

- [ ] **Step 5: Actions `src/app/actions/task-board.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext, type OrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { LIMITS } from "@/config/limits";
import { audit } from "@/lib/audit";
import { compareBoardCards, normalizeColumnName, ORDER_STEP, orderForInsert } from "@/lib/tasks/board-core";

export type TaskBoardError = "unauthorized" | "forbidden" | "invalid" | "not_found" | "limit" | "entrance" | "unknown";
export type TaskBoardResult = { ok: true } | { ok: false; error: TaskBoardError };

type Gate = { ok: true; ctx: OrgContext } | { ok: false; error: TaskBoardError };

/** Session + the "tasks" screen + the Tasks module — the route layout's gates,
 * repeated because server actions are public endpoints. */
async function gate(): Promise<Gate> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "tasks") || !hasModule(ctx.modules, "tasks")) return { ok: false, error: "forbidden" };
  return { ok: true, ctx };
}

function saved(): TaskBoardResult {
  revalidatePath("/app/tasks");
  return { ok: true };
}

/** Put a card in `columnId`, right above `beforeTaskId` (null = at the end). */
export async function moveTaskOnBoard(
  taskId: string,
  columnId: string,
  beforeTaskId: string | null,
): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    const db = tenantDb(orgId);
    const [task, column] = await Promise.all([
      db.task.findFirst({ where: { id: taskId }, select: { id: true } }),
      db.taskBoardColumn.findFirst({ where: { id: columnId }, select: { id: true, isEntrance: true } }),
    ]);
    if (!task || !column) return { ok: false, error: "not_found" };

    await db.$transaction(
      async (tx) => {
        // The column's OTHER cards in display order; the entrance also holds the
        // cards with no column yet (new tasks).
        const inColumn = column.isEntrance
          ? { OR: [{ boardColumnId: columnId }, { boardColumnId: null }] }
          : { boardColumnId: columnId };
        let cards = (
          await tx.task.findMany({
            where: { organizationId: orgId, id: { not: taskId }, ...inColumn },
            select: { id: true, boardOrder: true, createdAt: true },
          })
        ).sort(compareBoardCards);

        const found = beforeTaskId ? cards.findIndex((c) => c.id === beforeTaskId) : -1;
        const index = found === -1 ? cards.length : found;
        let order = orderForInsert(
          cards.map((c) => c.boardOrder),
          index,
        );
        if (order === null) {
          // Neighbours tied or too close: renumber the column, then insert.
          for (const [i, card] of cards.entries()) {
            await tx.task.updateMany({
              where: { id: card.id, organizationId: orgId },
              data: { boardOrder: (i + 1) * ORDER_STEP },
            });
          }
          cards = cards.map((c, i) => ({ ...c, boardOrder: (i + 1) * ORDER_STEP }));
          order = orderForInsert(
            cards.map((c) => c.boardOrder),
            index,
          ) as number;
        }
        const res = await tx.task.updateMany({
          where: { id: taskId, organizationId: orgId },
          data: { boardColumnId: columnId, boardOrder: order },
        });
        if (res.count !== 1) throw new Error("task not found during move");
      },
      { timeout: 20_000 },
    );
    return saved();
  } catch (error) {
    console.error("Failed to move task on board", error);
    return { ok: false, error: "unknown" };
  }
}

export async function createTaskBoardColumn(rawName: string): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  const name = normalizeColumnName(String(rawName));
  if (!name) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(g.ctx.organizationId);
    const columns = await db.taskBoardColumn.findMany({ select: { order: true } });
    if (columns.length === 0) return { ok: false, error: "invalid" }; // board not built yet
    if (columns.length >= LIMITS.taskBoardColumnsMax) return { ok: false, error: "limit" };
    const order = columns.reduce((max, c) => Math.max(max, c.order), -1) + 1;
    await db.taskBoardColumn.create({ data: { organizationId: g.ctx.organizationId, name, order } });
    return saved();
  } catch (error) {
    console.error("Failed to create task board column", error);
    return { ok: false, error: "unknown" };
  }
}

export async function renameTaskBoardColumn(id: string, rawName: string): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  const name = normalizeColumnName(String(rawName));
  if (!name) return { ok: false, error: "invalid" };
  try {
    const res = await tenantDb(g.ctx.organizationId).taskBoardColumn.updateMany({ where: { id }, data: { name } });
    if (res.count === 0) return { ok: false, error: "not_found" };
    return saved();
  } catch (error) {
    console.error("Failed to rename task board column", error);
    return { ok: false, error: "unknown" };
  }
}

/** Swap a column with its left/right neighbour. */
export async function moveTaskBoardColumn(id: string, direction: "left" | "right"): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (direction !== "left" && direction !== "right") return { ok: false, error: "invalid" };
  const orgId = g.ctx.organizationId;
  try {
    const db = tenantDb(orgId);
    const columns = await db.taskBoardColumn.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const i = columns.findIndex((c) => c.id === id);
    if (i === -1) return { ok: false, error: "not_found" };
    const j = direction === "left" ? i - 1 : i + 1;
    if (j < 0 || j >= columns.length) return saved(); // already at the edge
    [columns[i], columns[j]] = [columns[j], columns[i]];
    await db.$transaction(async (tx) => {
      for (const [order, column] of columns.entries()) {
        await tx.taskBoardColumn.updateMany({ where: { id: column.id, organizationId: orgId }, data: { order } });
      }
    });
    return saved();
  } catch (error) {
    console.error("Failed to move task board column", error);
    return { ok: false, error: "unknown" };
  }
}

/** Make `id` the entrance. Cards sitting in the old entrance with no column
 * stay there: the old entrance id is written on them first. */
export async function setTaskBoardEntrance(id: string): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    const db = tenantDb(orgId);
    const [target, current] = await Promise.all([
      db.taskBoardColumn.findFirst({ where: { id }, select: { id: true } }),
      db.taskBoardColumn.findFirst({ where: { isEntrance: true }, select: { id: true } }),
    ]);
    if (!target) return { ok: false, error: "not_found" };
    if (current?.id === target.id) return saved();
    await db.$transaction(async (tx) => {
      if (current) {
        await tx.task.updateMany({
          where: { organizationId: orgId, boardColumnId: null },
          data: { boardColumnId: current.id },
        });
      }
      await tx.taskBoardColumn.updateMany({ where: { organizationId: orgId, isEntrance: true }, data: { isEntrance: false } });
      await tx.taskBoardColumn.updateMany({ where: { organizationId: orgId, id: target.id }, data: { isEntrance: true } });
    });
    await audit(g.ctx, { action: "task_board.entrance_changed", entity: "TaskBoardColumn", entityId: target.id });
    return saved();
  } catch (error) {
    console.error("Failed to set task board entrance", error);
    return { ok: false, error: "unknown" };
  }
}

/** Delete a column; its cards go back to the entrance (no column). The
 * entrance itself can't be deleted. */
export async function deleteTaskBoardColumn(id: string): Promise<TaskBoardResult> {
  const g = await gate();
  if (!g.ok) return g;
  const orgId = g.ctx.organizationId;
  try {
    const db = tenantDb(orgId);
    const column = await db.taskBoardColumn.findFirst({
      where: { id },
      select: { id: true, name: true, isEntrance: true },
    });
    if (!column) return { ok: false, error: "not_found" };
    if (column.isEntrance) return { ok: false, error: "entrance" };
    let cardsMoved = 0;
    await db.$transaction(async (tx) => {
      const res = await tx.task.updateMany({
        where: { organizationId: orgId, boardColumnId: column.id },
        data: { boardColumnId: null },
      });
      cardsMoved = res.count;
      await tx.taskBoardColumn.deleteMany({ where: { organizationId: orgId, id: column.id } });
    });
    await audit(g.ctx, {
      action: "task_board.column_deleted",
      entity: "TaskBoardColumn",
      entityId: column.id,
      meta: { name: column.name, cardsMoved },
    });
    return saved();
  } catch (error) {
    console.error("Failed to delete task board column", error);
    return { ok: false, error: "unknown" };
  }
}
```

(Check `audit`'s signature in `src/lib/audit.ts` and the `OrgContext` fields — `organizationId`, `modules`, `allowedScreens` — before relying on them. `src/app/actions/email-broadcasts.ts` uses the same pattern.)

- [ ] **Step 6: Realtime** (`src/lib/queries/realtime.ts`)

In `realtimeFingerprints`, add `taskCol` to the destructuring right after `task` (`… opp, task, taskCol, feedPost, feedReaction] = await Promise.all([`), and the aggregate right after the `db.task.aggregate(...)` line:

```ts
    // Column renames/adds/removes on the Tasks kanban refresh open boards too.
    db.taskBoardColumn.aggregate({ _max: { updatedAt: true }, _count: { _all: true } }),
```

Change the `tasks` fingerprint to:

```ts
    tasks: `${ms(task._max.updatedAt)}:${task._count._all}:${ms(taskCol._max.updatedAt)}:${taskCol._count._all}`,
```

- [ ] **Step 7: Verify**

Run (no `next dev` running): `npm run typecheck && npm run lint && npm run build && npm run check:tasks && npm run check:isolation`.
Expected: PASS; lint shows only the 4 pre-existing warnings.

- [ ] **Step 8: Commit**

```bash
git add src/config/limits.ts src/lib/tasks/board.ts src/lib/queries/task-board.ts src/app/actions/task-board.ts src/lib/queries/tasks.ts src/lib/queries/realtime.ts docs/guia/04-modulos-e-permissoes.md
git commit -m "[Tarefas] - Adiciona a montagem do quadro e as actions de colunas e cards" -m "Quadro criado na primeira abertura com trava por empresa; mover card, criar, renomear, reordenar, trocar entrada e excluir coluna." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tela (quadro, coluna, card, rolagem e textos)

**Files:**
- Modify: `src/app/[locale]/app/tasks/page.tsx`
- Modify (rewrite): `src/components/tasks/tasks-board.tsx`
- Create: `src/components/tasks/board-column.tsx`
- Create: `src/components/tasks/board-card.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/messages/pt.json`, `src/messages/en.json`, `CLAUDE.md`, `docs/guia/04-modulos-e-permissoes.md`

**Interfaces:**
- Consumes:
  - Task 2: `BoardColumn`, `COLUMN_NAME_MAX`, `compareBoardCards`, `effectiveColumnId`, `normalizeColumnName`, `orderForInsert`;
  - Task 3: `ensureTaskBoard`, `listTaskBoardColumns`, the six actions and `TaskBoardResult`, `LIMITS.taskBoardColumnsMax`, `TaskRow.boardColumnId/boardOrder/createdAt`;
  - existing: `toggleTask`, `deleteTask` (`@/app/actions/tasks`), `useConfirm`, `usePrompt`, `useToast`, `useRealtime`.

- [ ] **Step 1: Texts** — inside `tasks.board` (the second `"board": {` block in each file, ~line 2329; the first one at ~1409 is another namespace), after `"empty": …`, add 15 keys.

pt.json:

```json
      "addColumn": "Nova coluna",
      "columnName": "Nome da coluna",
      "columnMenu": "Opções da coluna",
      "rename": "Renomear",
      "setEntrance": "Definir como entrada",
      "entrance": "Entrada: tarefas novas aparecem aqui",
      "moveLeft": "Mover para a esquerda",
      "moveRight": "Mover para a direita",
      "deleteColumn": "Excluir coluna",
      "deleteColumnConfirm": "Excluir a coluna \"{name}\"? {count, plural, =0 {Ela está vazia.} one {O card dela vai para \"{entrance}\".} other {Os # cards dela vão para \"{entrance}\".}}",
      "entranceCantDelete": "Defina outra coluna como entrada antes de excluir esta.",
      "moveTo": "Mover para…",
      "errorLimit": "Limite de {max} colunas atingido.",
      "errorName": "O nome da coluna precisa ter de 1 a 40 caracteres.",
      "errorSave": "Não foi possível salvar a alteração. Tente de novo."
```

en.json:

```json
      "addColumn": "New column",
      "columnName": "Column name",
      "columnMenu": "Column options",
      "rename": "Rename",
      "setEntrance": "Set as entrance",
      "entrance": "Entrance: new tasks show up here",
      "moveLeft": "Move left",
      "moveRight": "Move right",
      "deleteColumn": "Delete column",
      "deleteColumnConfirm": "Delete the column \"{name}\"? {count, plural, =0 {It's empty.} one {Its card moves to \"{entrance}\".} other {Its # cards move to \"{entrance}\".}}",
      "entranceCantDelete": "Set another column as the entrance before deleting this one.",
      "moveTo": "Move to…",
      "errorLimit": "You've reached the {max}-column limit.",
      "errorName": "The column name must have 1 to 40 characters.",
      "errorSave": "Couldn't save the change. Try again."
```

Parity/count check (expect `2803 2803 [] []`):

```bash
node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,p+k+'.'):[p+k]);const a=new Set(f(require('./src/messages/pt.json'))),b=new Set(f(require('./src/messages/en.json')));console.log(a.size,b.size,[...a].filter(k=>!b.has(k)),[...b].filter(k=>!a.has(k)))"
```

Update 2788 → 2803 in `CLAUDE.md` ("chaves (N hoje)") and `docs/guia/04-modulos-e-permissoes.md` ("**N chaves-folha cada um**").

- [ ] **Step 2: Visible horizontal bar** — in `src/app/globals.css`, right after the `::-webkit-scrollbar-thumb:hover { … }` rule (inside the same block):

```css
  /* Tasks kanban: the themed bar above is too faint to notice on a wide board,
     so the board's horizontal bar is thicker and contrasted. */
  .board-scroll {
    scrollbar-width: auto;
    scrollbar-color: var(--muted-foreground) var(--muted);
  }
  .board-scroll::-webkit-scrollbar {
    height: 14px;
  }
  .board-scroll::-webkit-scrollbar-track {
    background: var(--muted);
    border-radius: 9999px;
  }
  .board-scroll::-webkit-scrollbar-thumb {
    background-color: var(--muted-foreground);
  }
```

- [ ] **Step 3: Page** — replace `src/app/[locale]/app/tasks/page.tsx` with:

```tsx
import { getTranslations } from "next-intl/server";
import { LayoutGrid, List } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { hasModule } from "@/config/modules";
import { listTasks } from "@/lib/queries/tasks";
import { listMembers } from "@/lib/queries/organizations";
import { contactOptions } from "@/lib/queries/contacts";
import { opportunityOptions } from "@/lib/queries/crm";
import { listTaskBoardColumns } from "@/lib/queries/task-board";
import { ensureTaskBoard } from "@/lib/tasks/board";
import { TasksManager } from "@/components/tasks/tasks-manager";
import { TasksBoard } from "@/components/tasks/tasks-board";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const segBase = "rounded-md px-2 py-1 transition-colors";
const segActive = "bg-muted text-foreground";
const segIdle = "text-muted-foreground hover:text-foreground";

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("tasks");
  const view = (await searchParams)?.view === "kanban" ? "kanban" : "list";

  // The board must exist (and hold the tasks' columns) before tasks are listed.
  if (view === "kanban") {
    await ensureTaskBoard(ctx.organizationId, {
      overdue: t("board.overdue"),
      today: t("board.today"),
      upcoming: t("board.upcoming"),
      nodate: t("board.nodate"),
      done: t("board.done"),
    });
  }

  const hasCrm = hasModule(ctx.modules, "crm");
  const [tasks, rawMembers, contacts, opportunities, columns] = await Promise.all([
    listTasks(ctx.organizationId, { scope: "all" }),
    listMembers(ctx.organizationId),
    hasCrm ? contactOptions(ctx.organizationId) : Promise.resolve([]),
    hasCrm ? opportunityOptions(ctx.organizationId) : Promise.resolve([]),
    view === "kanban" ? listTaskBoardColumns(ctx.organizationId) : Promise.resolve([]),
  ]);

  // Anyone can assign a task to any member (users hand tasks to each other).
  const members = rawMembers;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
        <p className="mt-1 text-muted-foreground">{t("pageSubtitle")}</p>
      </div>
      <div className="flex items-center rounded-lg border border-border p-0.5">
        <Link href="/app/tasks" aria-label={t("viewList")} title={t("viewList")} className={cn(segBase, view === "list" ? segActive : segIdle)}>
          <List className="size-4" />
        </Link>
        <Link
          href="/app/tasks?view=kanban"
          aria-label={t("viewKanban")}
          title={t("viewKanban")}
          className={cn(segBase, view === "kanban" ? segActive : segIdle)}
        >
          <LayoutGrid className="size-4" />
        </Link>
      </div>
    </div>
  );

  if (view === "kanban") {
    // Height = viewport − app header − main's padding, so the board's bottom
    // (and its horizontal bar) stays on screen. Verified in the browser (Task 5).
    return (
      <div className="flex h-[calc(100dvh-7rem)] flex-col gap-6 md:h-[calc(100dvh-7.5rem)]">
        {header}
        <TasksBoard tasks={tasks} columns={columns} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <TasksManager
        tasks={tasks}
        members={members.map((m) => ({ id: m.userId, name: m.name }))}
        contacts={contacts}
        opportunities={opportunities}
        currentUserId={ctx.userId}
        showTabs
        hasCrm={hasCrm}
      />
    </div>
  );
}
```

- [ ] **Step 4: Card** — create `src/components/tasks/board-card.tsx`:

```tsx
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
            className="relative rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
```

- [ ] **Step 5: Column** — create `src/components/tasks/board-column.tsx`:

```tsx
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
```

- [ ] **Step 6: Board** — replace `src/components/tasks/tasks-board.tsx` with:

```tsx
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
```

(Before writing: confirm `usePrompt`'s options — `title`, `label`, `confirmLabel` — in `src/components/ui/prompt.tsx`; that `<PromptProvider>` is mounted in the app (`grep -rn "PromptProvider" src`); and that `src/config/limits.ts` has no server-only import, so it is client-safe. If `PromptProvider` isn't mounted, report it instead of mounting it.)

- [ ] **Step 7: Verify**

`grep -n "board\.\(overdue\|today\)" src/components/tasks/tasks-board.tsx` → nothing. The column titles now come from the DB, and the old fixed `t(\`board.${col}\`)` is gone.

Run (no `next dev`): `npm run typecheck && npm run lint && npm run build && npm run check:tasks`, plus the parity one-liner (`2803 2803 [] []`). Expected: PASS; lint only the 4 pre-existing warnings.

- [ ] **Step 8: Commit**

```bash
git add "src/app/[locale]/app/tasks/page.tsx" src/components/tasks/tasks-board.tsx src/components/tasks/board-column.tsx src/components/tasks/board-card.tsx src/app/globals.css src/messages/pt.json src/messages/en.json CLAUDE.md docs/guia/04-modulos-e-permissoes.md
git commit -m "[Tarefas] - Troca o kanban por colunas livres com cards moveis" -m "Renomear, criar, reordenar, definir entrada e excluir coluna; arrastar e Mover para; barra horizontal visivel e rolagem automatica ao arrastar." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Teste no navegador local, README e verificação final

**Files:**
- Modify: `README.md`
- Possibly modify: `src/app/[locale]/app/tasks/page.tsx` (height calc only, if Step 3 shows it's wrong)

This task needs a real browser. **It is run by the controller** (browser-harness skill, or with the user), not by a subagent without browser access.

- [ ] **Step 1: Fake local data** (Docker DB, org "MétodoAI Demo", slug `metodoai-demo`)

Use a node script in the session scratchpad (never in the repo) with `pg` and `--env-file=.env`:
1. Create 6 tasks titled `QA-KB-1`..`QA-KB-6` in that org:
   - `createdById`/`assignedToId` = the org owner's userId;
   - `type`/`priority`/`status` at their defaults;
   - due dates (São Paulo): yesterday 10:00, today 23:30, today 09:00, in 3 days, none, and one done (`doneAt` = now, status `DONE`).
2. Reset the board so the first-open path runs:
   - `DELETE FROM task_board_columns WHERE "organizationId" = <org>`;
   - `UPDATE tasks SET "boardColumnId" = NULL WHERE "organizationId" = <org>`.

- [ ] **Step 2: Run the checklist**

Start `npm run dev` (or `npx next dev --webpack`) on :3000, log in with `SEED_OWNER_EMAIL`/`SEED_OWNER_PASSWORD` from `.env`, and work through the list below. Record each result.

1. **First open (two tabs at once):** open `/app/tasks?view=kanban` in two tabs as fast as possible. Then `SELECT count(*) FROM task_board_columns WHERE "organizationId" = <org>` = **5**. The columns are Atrasadas, Hoje, Em breve, Sem data ★ and Concluídas. QA-KB tasks:
   - yesterday → Atrasadas;
   - today 09:00 and 23:30 → Hoje;
   - +3 days → Em breve;
   - none → Sem data;
   - done → Concluídas.
2. **Drag between columns:** drag QA-KB-1 to "Em breve" between two cards. It stays there after a reload, and its due date didn't change.
3. **Drag within a column:** move a card to the top. The order survives a reload.
4. **Drop in place:** drop a card on its own slot. No request in the Network tab and no reorder.
5. **"Mover para…"** on a card → choose "Hoje". The card goes to the end of "Hoje".
6. **Check:** mark QA-KB-2 done. It stays in its column, struck through. Drag a card into "Concluídas": the task is NOT completed.
7. **Rename:** click "Hoje", type "Esta semana", Enter. Reload; the name persists. Esc while editing cancels.
8. **New column:** "+ Nova coluna" → "Revisão". It appears at the end. A name of 41+ chars → error toast.
9. **Reorder columns:** ⋯ → Mover para a esquerda/direita. The first column's "left" and the last column's "right" are disabled.
10. **Entrance:** ⋯ on "Revisão" → Definir como entrada. The ★ moves. The QA-KB "none" card stays in "Sem data". Create a task in the list view → it appears in "Revisão".
11. **Delete:** ⋯ on "Sem data" → Excluir. The confirmation states the card count. The cards go to the entrance ("Revisão"). On the entrance, Excluir is disabled with the hint.
12. **Horizontal bar:** with 6 columns at 1366×768 (or the narrowest laptop width you have):
    - the horizontal bar is visible without scrolling the page;
    - in the console, `const m=document.querySelector('main'); m.scrollHeight<=m.clientHeight` → `true`.
    - If it's `false` or the bar is hidden, adjust only the `md:h-[calc(100dvh-…)]` in the tasks page until both hold. Note the final value.
13. **Auto-scroll:** narrow the window, drag a card to the right edge. The board scrolls to reach the last column.
14. **Realtime:** in tab 2, rename a column. Tab 1 updates within a few seconds.
15. **Mobile width (≈390px):** the board scrolls horizontally, and "Mover para…" opens the native picker.

- [ ] **Step 3: Cleanup**

- Delete the QA-KB tasks.
- Reset the demo org's board again (delete its columns, set `boardColumnId = NULL`), so the next open rebuilds it from real data.
- Show zero counts for `title LIKE 'QA-KB-%'`.
- Stop the dev server (`netstat -ano | grep ":3000 " | grep LISTEN` → `taskkill //PID <pid> //F`).

- [ ] **Step 4: README**

- **§7:** add, near the other module notes:

  ```markdown
  - **Kanban de Tarefas (`/app/tasks?view=kanban`):** colunas livres da empresa (tabela
    `task_board_columns`, até 20), montadas na primeira abertura com as 5 antigas e cada tarefa onde
    aparecia (horário de Brasília). `tasks.boardColumnId` nulo = coluna de entrada (★), onde caem as
    tarefas novas; `tasks.boardOrder` tem padrão no banco (instante da criação), então nenhum caminho
    que cria tarefa precisa conhecer o quadro. Coluna não conclui tarefa. Regras puras em
    `src/lib/tasks/board-core.ts` (`npm run check:tasks`).
  ```

- **§8:** add after the previous "Antes do merge da branch …" block:

  ```markdown
  **Antes do merge da branch `feature/tarefas-kanban-colunas`:** aplicar no Supabase
  `prisma/migrations/20261008150000_task_board_columns/migration.sql` com `prisma db execute --file … --schema
  prisma/schema.prisma` e depois `prisma migrate resolve --applied 20261008150000_task_board_columns` (aditiva:
  tabela nova, duas colunas em `tasks` e FK com `SET NULL`). **Não** use `migrate deploy`.
  ```

- [ ] **Step 5: Final verification**

Run (no `next dev`):

`npm run typecheck && npm run lint && npm run build && npm run check:isolation && npm run check:node && npm run check:tasks && npm run check:email`

Expected: all PASS (`check:isolation` with 15 assertions).

Then `git diff --stat origin/main -- src/components/crm "src/app/[locale]/app/crm"` must be empty (the CRM board is untouched).

- [ ] **Step 6: Commit and stop**

```bash
git add README.md "src/app/[locale]/app/tasks/page.tsx"
git commit -m "[Docs] - Documenta o kanban de tarefas com colunas livres" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

No push. Pending with the user: apply the migration on Supabase before the merge.
