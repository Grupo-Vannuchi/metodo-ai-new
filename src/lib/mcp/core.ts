/**
 * Pure rules of the read-only MCP server (no DB, no `server-only`, no env): the
 * API key check, `YYYY-MM-DD` periods, pagination, decimal formatting, the
 * payroll fold of the finance summary and the scan that blocks sensitive keys
 * on the way out. Shared by src/lib/mcp/* and src/lib/queries/mcp/*; covered by
 * `npm run check:mcp` (scripts/check-mcp.ts).
 */
import { timingSafeEqual } from "node:crypto";

/** Bad tool input (a date, a period): the message goes back to the caller as is. */
export class McpInputError extends Error {}

// ── API key ──────────────────────────────────────────────────────────────────

/** The token of an `Authorization: Bearer <token>` header (scheme in any case), or null. */
export function extractBearer(header: string | null): string | null {
  const token = header?.match(/^\s*bearer\s+([\s\S]*)$/i)?.[1].trim();
  return token ? token : null;
}

/**
 * Constant-time key comparison, same shape as src/lib/cron-auth.ts. Both sides
 * are trimmed: a key pasted into hPanel or into the connector URL often carries
 * a trailing newline or space. Empty never matches.
 */
export function keysMatch(
  provided: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  const p = provided?.trim();
  const s = secret?.trim();
  if (!p || !s) return false;
  // timingSafeEqual throws when the buffers differ in length, so guard on that
  // first — length alone leaks nothing useful about a fixed-length random key.
  const a = Buffer.from(p);
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Dates and periods ────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** Longest accepted period (~10 years), so a typo like "1026" can't scan everything. */
const MAX_PERIOD_DAYS = 3660;

/**
 * "YYYY-MM-DD" → that day's midnight in UTC, which is how the Finance screen
 * stores `dueDate` (`new Date("yyyy-mm-dd")`).
 */
export function parseDay(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    // Date.UTC rolls 2026-02-30 over to March 2 — the round trip catches it.
    if (date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d) {
      return date;
    }
  }
  throw new McpInputError(`Data inválida: "${s}". Use o formato AAAA-MM-DD.`);
}

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const nextDay = (d: Date) => new Date(d.getTime() + DAY_MS);

function invertedPeriod(from: Date, to: Date): McpInputError {
  return new McpInputError(
    `A data final (${isoDay(to)}) não pode ser anterior à inicial (${isoDay(from)}).`,
  );
}

export type Period = { from: string; to: string; gte: Date; lt: Date };

/**
 * Period of a summary tool; `from` and `to` are inclusive UTC days. A missing
 * `to` is today; a missing `from` is the first day of `to`'s month, so "até
 * 30/09" alone means September rather than an inverted range.
 */
export function resolvePeriod(from: string | undefined, to: string | undefined, now: Date): Period {
  const end = to ? parseDay(to) : utcDayStart(now);
  const start = from ? parseDay(from) : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  if (start > end) throw invertedPeriod(start, end);
  if ((end.getTime() - start.getTime()) / DAY_MS > MAX_PERIOD_DAYS) {
    throw new McpInputError(`Período longo demais: o máximo é ${MAX_PERIOD_DAYS} dias.`);
  }
  return { from: isoDay(start), to: isoDay(end), gte: start, lt: nextDay(end) };
}

/** Optional date filter of a list tool: open on the missing side, null when both are missing. */
export function resolveRange(from?: string, to?: string): { gte?: Date; lt?: Date } | null {
  if (!from && !to) return null;
  const range: { gte?: Date; lt?: Date } = {};
  if (from) range.gte = parseDay(from);
  if (to) range.lt = nextDay(parseDay(to));
  if (range.gte && range.lt && range.gte >= range.lt) {
    throw invertedPeriod(range.gte, new Date(range.lt.getTime() - DAY_MS));
  }
  return range;
}

// ── Pagination ───────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Prisma `take`/`skip` of a list tool. Out-of-range values are clamped, not refused. */
export function page(limit?: number, offset?: number): { take: number; skip: number } {
  const l = Number.isFinite(limit) ? Math.trunc(limit!) : DEFAULT_LIMIT;
  const o = Number.isFinite(offset) ? Math.trunc(offset!) : 0;
  return { take: Math.min(MAX_LIMIT, Math.max(1, l)), skip: Math.max(0, o) };
}

export function listResult<T>(
  total: number,
  p: { take: number; skip: number },
  items: T[],
): { total: number; limit: number; offset: number; items: T[] } {
  return { total, limit: p.take, offset: p.skip, items };
}

// ── Decimals ─────────────────────────────────────────────────────────────────

type DecimalLike = { toString(): string } | number | null | undefined;

/** Money as a fixed 2-decimal string (Prisma.Decimal, number or numeric string in). */
export function money(v: DecimalLike): string | null {
  return v == null ? null : Number(v.toString()).toFixed(2);
}

/** Stock quantity as a fixed 3-decimal string, matching `Decimal(14, 3)`. */
export function qty(v: DecimalLike): string | null {
  return v == null ? null : Number(v.toString()).toFixed(3);
}

// ── Finance: the payroll fold ────────────────────────────────────────────────

export const PAYROLL_LABEL = "Folha de pagamento";
export const NO_CATEGORY_LABEL = "Sem categoria";

export type FinanceGroupRow = {
  type: "INCOME" | "EXPENSE";
  categoryName: string | null;
  payroll: boolean;
  total: number;
};
export type CategoryLine = { categoryName: string; total: string };

// Sums run in cents so a long list of entries doesn't drift by float error.
const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

/**
 * DRE-style breakdown for `resumo_financeiro`. Payroll rows (entries tied to an
 * employee or to a payroll run) all land in ONE "Folha de pagamento" line,
 * whatever their category, so no per-person amount ever leaves; the totals
 * still include them, matching the Finance screen.
 */
export function bucketByCategory(rows: FinanceGroupRow[]): {
  income: CategoryLine[];
  expense: CategoryLine[];
  totalIncome: string;
  totalExpense: string;
  result: string;
} {
  const sums = { INCOME: new Map<string, number>(), EXPENSE: new Map<string, number>() };
  for (const r of rows) {
    const name = r.payroll ? PAYROLL_LABEL : r.categoryName || NO_CATEGORY_LABEL;
    const byName = sums[r.type];
    byName.set(name, (byName.get(name) ?? 0) + cents(r.total));
  }
  const lines = (byName: Map<string, number>): CategoryLine[] =>
    [...byName]
      .sort((a, b) => b[1] - a[1])
      .map(([categoryName, c]) => ({ categoryName, total: fromCents(c) }));
  const sum = (byName: Map<string, number>) => [...byName.values()].reduce((acc, c) => acc + c, 0);
  const income = sum(sums.INCOME);
  const expense = sum(sums.EXPENSE);
  return {
    income: lines(sums.INCOME),
    expense: lines(sums.EXPENSE),
    totalIncome: fromCents(income),
    totalExpense: fromCents(expense),
    result: fromCents(income - expense),
  };
}

// ── Sensitive keys ───────────────────────────────────────────────────────────

/**
 * Field names that must never leave the MCP server (the spec's exclusion list
 * plus the re-audit: message/e-mail content, salaries and bank data, health
 * notes, credentials and tokens, free-text notes).
 */
export const FORBIDDEN_KEYS: readonly string[] = [
  "body", "quotedBody", "quotedSender", "senderName", "reactions", "mediaUrl", "mediaName",
  "lastMessagePreview", "remoteJid", "payload", "prompt", "content", "html", "signatureHtml",
  "signatureText", "audience", "attachments", "lastError", "baseSalary", "netPay", "totalEarnings",
  "totalDeductions", "totalNet", "bankName", "bankBranch", "bankAccount", "pixKey", "document",
  "address", "birthDate", "terminationReason", "decisionNote", "notes", "intro", "employeeId",
  "payrollRunId", "passwordHash", "tokenHash", "credentialsEnc", "credentials", "secret",
  "pageToken", "meta", "webhookToken", "accessToken", "refreshToken", "password",
];
const FORBIDDEN = new Set(FORBIDDEN_KEYS);

/**
 * Paths of every key in `value` that names a sensitive field, e.g.
 * "items[0].body". Keys only — a value that happens to read "body" is fine.
 * The last gate on every tool response, and the e2e sweep's assertion.
 */
export function findSensitiveKeys(value: unknown): string[] {
  const walk = (v: unknown, path: string): string[] => {
    if (Array.isArray(v)) return v.flatMap((item, i) => walk(item, `${path}[${i}]`));
    if (v === null || typeof v !== "object" || v instanceof Date) return [];
    return Object.entries(v).flatMap(([key, child]) => {
      const p = path ? `${path}.${key}` : key;
      return FORBIDDEN.has(key) ? [p] : walk(child, p);
    });
  };
  return walk(value, "");
}
