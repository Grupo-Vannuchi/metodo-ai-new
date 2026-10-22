/**
 * End-to-end check of the read-only MCP server (src/lib/mcp/) against a running
 * `next dev` — http://localhost:3000/api/mcp unless MCP_E2E_URL says otherwise.
 *
 * Creates its own data in the local Postgres: two organizations (B stays
 * empty) and, in org A, records for every module with a sentinel string
 * (`ctx.secret`) planted in every sensitive field. Then it talks to the server
 * through the official MCP client, asserts on the answers and ALWAYS deletes
 * what it created, even on failure.
 *
 * Run: npm run check:mcp:e2e   (needs the Docker Postgres, `next dev` on :3000
 * and MCP_API_KEY in .env — the same key the server reads). Exits non-zero on
 * the first failure.
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// `engineType = "client"` (schema.prisma) drops the Rust engine, so every
// PrismaClient needs an explicit driver adapter — same as src/lib/prisma.ts.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const KEY = process.env.MCP_API_KEY?.trim();
if (!KEY) {
  console.error("MCP_API_KEY is not set in .env — the e2e needs the key the server reads.");
  process.exit(1);
}
const BASE = process.env.MCP_E2E_URL ?? "http://localhost:3000/api/mcp";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type OrgRef = { id: string; name: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CallResult = { isError: boolean; text: string; json: any };
type Ctx = {
  stamp: number;
  /** Planted in every sensitive field of org A; must never come back. */
  secret: string;
  orgA: OrgRef;
  orgB: OrgRef;
  userA: { id: string; name: string; email: string };
  /** Ids a module's fixtures leave for a later module (e.g. contactA, employeeA). */
  ids: Record<string, string>;
  prisma: PrismaClient;
  call(name: string, args: object): Promise<CallResult>;
};

/** Module sections below push into these; main() runs them in order. */
const fixtures: ((ctx: Ctx) => Promise<void>)[] = [];
const cleanups: ((ctx: Ctx) => Promise<void>)[] = [];
const checks: { name: string; run: (ctx: Ctx) => Promise<void> }[] = [];

// ── Base: two organizations, an owner for A ──────────────────────────────────

async function baseFixtures(ctx: Ctx): Promise<void> {
  const { stamp } = ctx;
  const user = await prisma.user.create({
    data: { name: `MCP-E2E-A-${stamp} Dono`, email: `mcp-a-${stamp}@test.local`, passwordHash: "x" },
  });
  ctx.userA = { id: user.id, name: user.name, email: user.email };
  const orgA = await prisma.organization.create({
    data: { name: `MCP-E2E-A-${stamp}`, slug: `mcp-e2e-a-${stamp}`, ownerId: user.id },
  });
  const orgB = await prisma.organization.create({
    data: { name: `MCP-E2E-B-${stamp}`, slug: `mcp-e2e-b-${stamp}` },
  });
  ctx.orgA = { id: orgA.id, name: orgA.name };
  ctx.orgB = { id: orgB.id, name: orgB.name };
  await prisma.membership.create({ data: { organizationId: orgA.id, userId: user.id, role: "OWNER" } });
  await prisma.organizationModule.createMany({
    data: [
      { organizationId: orgA.id, moduleId: "crm", status: "ACTIVE" },
      { organizationId: orgA.id, moduleId: "finance", status: "DORMANT" },
    ],
  });
}

async function baseCleanup(ctx: Ctx): Promise<void> {
  const orgIds = [ctx.orgA?.id, ctx.orgB?.id].filter(Boolean) as string[];
  // Memberships and modules cascade from the organization.
  if (orgIds.length) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  if (ctx.userA?.id) await prisma.user.deleteMany({ where: { id: ctx.userA.id } });
}

// ── Transport and auth ───────────────────────────────────────────────────────

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "check-mcp-e2e", version: "1.0.0" },
  },
};

function postInitialize(url: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(INITIALIZE),
  });
}

checks.push({
  name: "no key, a wrong key in the path or a wrong Bearer all get 404",
  run: async () => {
    assert.equal((await postInitialize(BASE)).status, 404);
    assert.equal((await postInitialize(`${BASE}/${"0".repeat(64)}`)).status, 404);
    assert.equal((await postInitialize(BASE, { authorization: `Bearer ${"0".repeat(64)}` })).status, 404);
  },
});

checks.push({
  name: "GET with the right key is 405 (no SSE stream) and says POST is allowed",
  run: async () => {
    const res = await fetch(`${BASE}/${KEY}`, { method: "GET", headers: { accept: "text/event-stream" } });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  },
});

checks.push({
  name: "the official client connects with the key in the path and pings",
  run: async () => {
    const client = new Client({ name: "check-mcp-e2e-path", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/${KEY}`)));
    await client.ping();
    await client.close();
  },
});

checks.push({
  name: "the official client connects with the key in the Authorization header",
  run: async () => {
    const client = new Client({ name: "check-mcp-e2e-header", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(BASE), {
        requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
      }),
    );
    assert.equal(client.getServerVersion()?.name, "metodoai");
    await client.close();
  },
});

// ── Runner ───────────────────────────────────────────────────────────────────

async function callTool(client: Client, name: string, args: object): Promise<CallResult> {
  const res = await client.callTool({ name, arguments: args as Record<string, unknown> });
  const text = (res.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // error results are plain text
  }
  return { isError: res.isError === true, text, json };
}

async function main(): Promise<number> {
  const stamp = Date.now();
  const ctx = {
    stamp,
    secret: `MCPSEGREDO${stamp}`,
    ids: {},
    prisma,
    call: async () => {
      throw new Error("MCP client not connected yet");
    },
  } as unknown as Ctx;
  let client: Client | null = null;
  let passed = 0;
  try {
    await baseFixtures(ctx);
    for (const fixture of fixtures) await fixture(ctx);

    client = new Client({ name: "check-mcp-e2e", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/${KEY}`)));
    const connected = client;
    ctx.call = (name, args) => callTool(connected, name, args);

    for (const check of checks) {
      await check.run(ctx);
      passed++;
      console.log(`  ✓ ${check.name}`);
    }
    return passed;
  } finally {
    await client?.close().catch(() => {});
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup(ctx).catch((e) => console.error("cleanup failed:", e));
    }
    await baseCleanup(ctx).catch((e) => console.error("base cleanup failed:", e));
    await prisma.$disconnect();
  }
}

main()
  .then((passed) => console.log(`\ncheck:mcp:e2e — ${passed} checks passed`))
  .catch((e) => {
    // An error can echo the request URL (a 404 page does), and the URL carries
    // the key: never let it reach the terminal.
    const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    console.error("\nMCP E2E FAILED:", detail.split(KEY!).join("<MCP_API_KEY>").slice(0, 4000));
    process.exit(1);
  });
