/**
 * Self-check for the Redis-backed rate limiter (src/lib/ratelimit.ts) against a
 * fake Upstash REST server on 127.0.0.1. No real Redis, no database and no
 * `.env`: the required variables get dummy values here, only to let `env.ts`
 * load. Proves the limiter blocks over the limit and, above all, that a Redis
 * that refuses the token, errors, hangs or is down lets the request through
 * (fail-open) instead of taking login with it. Run with `npm run check:ratelimit`.
 */
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Mode = "ok" | "unauthorized" | "error" | "hang";
let mode: Mode = "ok";
const used = new Map<string, number>();
const seen: { auth: string[]; keys: string[] } = { auth: [], keys: [] };
const hanging: http.ServerResponse[] = [];

// In "ok" mode, emulates the sliding-window script as a plain counter per
// current-window key: `[remaining, limit]`, or `[-1, limit]` when full.
function runCommand(cmd: unknown[]): { result?: unknown; error?: string } {
  const name = String(cmd[0]).toLowerCase();
  if (name !== "evalsha" && name !== "eval") return { error: `ERR unsupported command ${name}` };
  const numKeys = Number(cmd[2]);
  const keys = cmd.slice(3, 3 + numKeys).map(String);
  const [tokens, , , incrementBy] = cmd.slice(3 + numKeys).map(Number);
  const key = keys[0];
  seen.keys.push(key);
  const count = used.get(key) ?? 0;
  if (incrementBy > 0 && count >= tokens) return { result: [-1, tokens] };
  used.set(key, count + incrementBy);
  return { result: [tokens - (count + incrementBy), tokens] };
}

// Answers the Upstash REST protocol: POST / with one JSON command array gets
// `{ result }`; POST /pipeline (what the client's auto-pipelining sends) with an
// array of commands gets an array of `{ result }`.
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    seen.auth.push(String(req.headers.authorization ?? ""));
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (mode === "hang") return void hanging.push(res);
    if (mode === "unauthorized") return reply(401, { error: "WRONGPASS invalid or missing auth token" });
    if (mode === "error") return reply(500, { error: "ERR internal error" });

    const body = JSON.parse(raw) as unknown[];
    if (Array.isArray(body[0])) return reply(200, (body as unknown[][]).map(runCommand));
    const out = runCommand(body);
    return reply(out.error ? 400 : 200, out);
  });
});

const warnings: string[] = [];
let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const start = Date.now();
  const value = await fn();
  return [value, Date.now() - start];
};
const warningsFor = (prefix: string) => warnings.filter((w) => w.startsWith(`[ratelimit] ${prefix}:`));

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  // Dummies so env.ts validates; nothing below reaches a database or a real Redis.
  process.env.DATABASE_URL ??= "postgresql://check:check@127.0.0.1:1/check";
  process.env.SESSION_SECRET ??= "check-ratelimit-session-secret-0000000000";
  process.env.INTEGRATION_ENC_KEY ??= "0".repeat(64);
  process.env.CRON_SECRET ??= "check-ratelimit-cron-secret-000000000000";
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${port}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = "check-ratelimit-dummy-token";

  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
  const { makeRateLimiter, isRedisConfigured, RATE_LIMIT_TIMEOUT_MS } = await import("../src/lib/ratelimit");

  try {
    await check("with Redis configured, the limiter exists and is reused per (prefix, limit, window)", async () => {
      assert.equal(isRedisConfigured(), true);
      const a = makeRateLimiter("check-login", 3, 60);
      assert.ok(a);
      assert.equal(makeRateLimiter("check-login", 3, 60), a, "same instance");
      assert.notEqual(makeRateLimiter("check-login", 4, 60), a, "another limit is another limiter");
    });

    await check("within the limit passes, over it blocks, each identifier counts apart, and Redis sees a hash", async () => {
      const limiter = makeRateLimiter("check-login", 3, 60)!;
      const results: boolean[] = [];
      for (let i = 0; i < 4; i++) results.push((await limiter.limit("ana@example.com")).success);
      assert.deepEqual(results, [true, true, true, false]);
      assert.equal((await limiter.limit("bia@example.com")).success, true, "another e-mail is not blocked");
      assert.ok(seen.auth.every((a) => a === "Bearer check-ratelimit-dummy-token"), "sends the token");
      const keyed = createHmac("sha256", process.env.SESSION_SECRET!).update("ratelimit:ana@example.com").digest("hex").slice(0, 32);
      const plain = createHash("sha256").update("ana@example.com").digest("hex").slice(0, 32);
      assert.ok(seen.keys.some((k) => k.startsWith(`check-login:${keyed}:`)), `key: ${seen.keys[0]}`);
      assert.ok(!seen.keys.some((k) => k.includes("@")), "Redis never sees the e-mail");
      assert.ok(!seen.keys.some((k) => k.includes(plain)), "nor a plain sha256 anyone could recompute");
      assert.equal(warningsFor("check-login").length, 0, "no warning while Redis answers");
    });

    await check("a Redis that refuses the token lets the request through and warns", async () => {
      mode = "unauthorized";
      const [res, ms] = await timed(() => makeRateLimiter("check-401", 3, 60)!.limit("ana@example.com"));
      assert.equal(res.success, true);
      assert.ok(ms < 1500, `answered in ${ms} ms`);
      assert.equal(warningsFor("check-401").length, 1, warnings.join("\n"));
      assert.ok(warningsFor("check-401")[0].includes("WRONGPASS"), "says why");
      assert.ok(!warnings.some((w) => w.includes("ana@example.com")), `no e-mail in the log: ${warnings.join("\n")}`);
    });

    await check("a Redis that answers 500 lets the request through", async () => {
      mode = "error";
      const res = await makeRateLimiter("check-500", 3, 60)!.limit("ana@example.com");
      assert.equal(res.success, true);
      assert.equal(warningsFor("check-500").length, 1);
    });

    await check(`a Redis that never answers lets the request through after ~${RATE_LIMIT_TIMEOUT_MS} ms`, async () => {
      mode = "hang";
      const [res, ms] = await timed(() => makeRateLimiter("check-hang", 3, 60)!.limit("ana@example.com"));
      assert.equal(res.success, true);
      assert.ok(ms >= RATE_LIMIT_TIMEOUT_MS - 100 && ms < RATE_LIMIT_TIMEOUT_MS + 1500, `answered in ${ms} ms`);
      assert.equal(warningsFor("check-hang").length, 1);
    });

    await check("a Redis that is down lets the request through fast, warning once a minute per prefix", async () => {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const limiter = makeRateLimiter("check-down", 3, 60)!;
      const [res, ms] = await timed(() => limiter.limit("ana@example.com"));
      assert.equal(res.success, true);
      assert.ok(ms < 3000, `answered in ${ms} ms`);
      assert.equal((await limiter.limit("ana@example.com")).success, true);
      assert.equal((await limiter.limit("bia@example.com")).success, true);
      assert.equal(warningsFor("check-down").length, 1, "one warning for three failures");
    });

    await check("no warning carries the identifier (e-mail) being limited", async () => {
      assert.ok(warnings.length >= 4, `${warnings.length} warnings`);
      for (const w of warnings) assert.ok(!/example\.com/.test(w), `identifier leaked: ${w}`);
    });
  } finally {
    console.warn = originalWarn;
    if (server.listening) {
      server.closeAllConnections();
      server.close();
    }
  }
  console.log(`\nOK: ${passed} checks passed`);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
