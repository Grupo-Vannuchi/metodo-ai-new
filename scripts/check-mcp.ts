/**
 * Self-check for the pure helpers of the read-only MCP server (no DB, no
 * network, no env): API key check, date periods, pagination, payroll
 * bucketing and the sensitive-key scan — plus a static guard that no MCP file
 * calls a Prisma write or raw SQL. Run with `npm run check:mcp`; exits
 * non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bucketByCategory,
  extractBearer,
  findSensitiveKeys,
  keysMatch,
  McpInputError,
  money,
  page,
  parseDay,
  qty,
  resolvePeriod,
  resolveRange,
} from "../src/lib/mcp/core";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const at = (iso: string) => new Date(iso);
const K = "a1".repeat(32);
const NOW = at("2026-10-22T15:00:00Z");

check("extractBearer takes the token after the Bearer scheme, any case, trimmed", () => {
  assert.equal(extractBearer("Bearer abc"), "abc");
  assert.equal(extractBearer("bearer  abc \n"), "abc");
  assert.equal(extractBearer("Basic abc"), null);
  assert.equal(extractBearer(null), null);
});

check("keysMatch ignores whitespace around either side (key pasted with a newline)", () => {
  assert.equal(keysMatch(K + "\n", K), true);
  assert.equal(keysMatch(" " + K, K + " "), true);
});

check("keysMatch rejects a cut, different-case, missing or empty key", () => {
  assert.equal(keysMatch(K.slice(1), K), false);
  assert.equal(keysMatch(K.toUpperCase(), K), false);
  assert.equal(keysMatch(K, undefined), false);
  assert.equal(keysMatch(undefined, K), false);
  assert.equal(keysMatch("", ""), false);
  assert.equal(keysMatch("  ", "  "), false);
});

check("parseDay reads YYYY-MM-DD as UTC midnight and rejects impossible dates and other formats", () => {
  assert.equal(parseDay("2026-10-01").toISOString(), "2026-10-01T00:00:00.000Z");
  assert.throws(() => parseDay("2026-02-30"), McpInputError);
  assert.throws(() => parseDay("01/10/2026"), McpInputError);
});

check("resolvePeriod defaults to the current UTC month up to today, inclusive", () => {
  const p = resolvePeriod(undefined, undefined, NOW);
  assert.equal(p.from, "2026-10-01");
  assert.equal(p.to, "2026-10-22");
  assert.equal(p.gte.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(p.lt.toISOString(), "2026-10-23T00:00:00.000Z");
});

check("resolvePeriod's `to` is inclusive: entries due on the first and on the last day are inside", () => {
  const p = resolvePeriod("2026-10-01", "2026-10-31", NOW);
  assert.equal(p.lt.toISOString(), "2026-11-01T00:00:00.000Z");
  const inside = (d: Date) => p.gte <= d && d < p.lt;
  assert.equal(inside(at("2026-10-01T00:00:00Z")), true);
  assert.equal(inside(at("2026-10-31T00:00:00Z")), true);
  assert.equal(inside(at("2026-11-01T00:00:00Z")), false);
  assert.equal(inside(at("2026-09-30T23:59:59Z")), false);
});

check("resolvePeriod with only `to` starts on the first day of that month", () => {
  const p = resolvePeriod(undefined, "2026-09-30", NOW);
  assert.equal(p.from, "2026-09-01");
  assert.equal(p.lt.toISOString(), "2026-10-01T00:00:00.000Z");
});

check("resolvePeriod rejects an inverted or overlong period in Portuguese, accepts ~10 years", () => {
  assert.throws(
    () => resolvePeriod("2026-10-10", "2026-10-01", NOW),
    (e: unknown) => e instanceof McpInputError && /não pode ser anterior/.test(e.message),
  );
  assert.throws(() => resolvePeriod("2010-01-01", "2026-10-01", NOW), McpInputError);
  assert.equal(resolvePeriod("2017-01-01", "2026-10-01", NOW).from, "2017-01-01");
});

check("resolveRange is open on the missing side, null when both are missing, and rejects inversion", () => {
  assert.equal(resolveRange(), null);
  assert.deepEqual(resolveRange("2026-10-01"), { gte: at("2026-10-01T00:00:00Z") });
  assert.deepEqual(resolveRange(undefined, "2026-10-31"), { lt: at("2026-11-01T00:00:00Z") });
  assert.throws(() => resolveRange("2026-10-10", "2026-10-01"), McpInputError);
});

check("page defaults to 50 from the start, clamps the limit to 1..200 and the offset to >= 0", () => {
  assert.deepEqual(page(), { take: 50, skip: 0 });
  assert.deepEqual(page(1000, 5), { take: 200, skip: 5 });
  assert.equal(page(0).take, 1);
  assert.equal(page(10, -3).skip, 0);
});

check("money and qty print fixed decimals, keep zero and keep null", () => {
  assert.equal(money("1234.5"), "1234.50");
  assert.equal(money(0), "0.00");
  assert.equal(money(null), null);
  assert.equal(qty("2.5"), "2.500");
});

check("bucketByCategory folds every payroll row into one 'Folha de pagamento' line and keeps the totals", () => {
  const r = bucketByCategory([
    { type: "EXPENSE", categoryName: "Aluguel", payroll: false, total: 1000 },
    { type: "EXPENSE", categoryName: "Salários", payroll: true, total: 4321.09 },
    { type: "EXPENSE", categoryName: "Salários", payroll: false, total: 200 },
    { type: "EXPENSE", categoryName: null, payroll: true, total: 100 },
    { type: "INCOME", categoryName: null, payroll: false, total: 5000 },
  ]);
  assert.deepEqual(r.expense, [
    { categoryName: "Folha de pagamento", total: "4421.09" },
    { categoryName: "Aluguel", total: "1000.00" },
    { categoryName: "Salários", total: "200.00" },
  ]);
  assert.deepEqual(r.income, [{ categoryName: "Sem categoria", total: "5000.00" }]);
  assert.equal(r.totalExpense, "5621.09");
  assert.equal(r.totalIncome, "5000.00");
  assert.equal(r.result, "-621.09");
});

check("findSensitiveKeys reports the path of every forbidden key, at any depth", () => {
  assert.deepEqual(findSensitiveKeys({ items: [{ name: "x", body: "y" }], nested: { meta: {} } }), [
    "items[0].body",
    "nested.meta",
  ]);
});

check("findSensitiveKeys looks at keys only, never at values", () => {
  assert.deepEqual(findSensitiveKeys({ name: "body", list: ["meta"], when: at("2026-10-01T00:00:00Z") }), []);
});

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith(".ts") ? [p] : [];
  });
}

check("no MCP file calls a Prisma write or raw SQL", () => {
  const WRITE =
    /\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\s*\(|\$(executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe)\b/;
  const offenders: string[] = [];
  for (const file of [...tsFiles("src/lib/mcp"), ...tsFiles("src/lib/queries/mcp")]) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (WRITE.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(offenders, []);
});

console.log(`\ncheck:mcp — ${passed} checks passed`);
