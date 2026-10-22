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
import { findSensitiveKeys } from "../src/lib/mcp/core";

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
type ListedTool = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  inputSchema: { properties?: Record<string, unknown> };
};
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
  tools(): Promise<ListedTool[]>;
};

/** Every tool the server must list — each module section appends its own. */
const EXPECTED_TOOLS: string[] = [];

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

/** Where-clause matching both test organizations — what every module cleanup deletes. */
function inTestOrgs(ctx: Ctx): { organizationId: { in: string[] } } {
  return { organizationId: { in: [ctx.orgA?.id, ctx.orgB?.id].filter((id): id is string => Boolean(id)) } };
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

// ── Plataforma ───────────────────────────────────────────────────────────────

EXPECTED_TOOLS.push("listar_organizacoes", "listar_membros", "resumo_organizacao");

checks.push({
  name: "tools/list has exactly the expected tools, every one marked read-only",
  run: async (ctx) => {
    const tools = await ctx.tools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...EXPECTED_TOOLS].sort());
    for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, `${t.name} is not read-only`);
  },
});

checks.push({
  name: "listar_organizacoes finds org A with its owner, members and module states",
  run: async (ctx) => {
    const r = await ctx.call("listar_organizacoes", { search: ctx.orgA.name });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.total, 1);
    const org = r.json.items[0];
    assert.equal(org.id, ctx.orgA.id);
    assert.equal(org.owner.email, ctx.userA.email);
    assert.equal(org.memberCount, 1);
    assert.deepEqual(
      [...org.modules].sort((a: { moduleId: string }, b: { moduleId: string }) => a.moduleId.localeCompare(b.moduleId)),
      [
        { moduleId: "crm", status: "ACTIVE" },
        { moduleId: "finance", status: "DORMANT" },
      ],
    );
  },
});

checks.push({
  name: "listar_organizacoes clamps limit 1000 down to 200",
  run: async (ctx) => {
    const r = await ctx.call("listar_organizacoes", { limit: 1000 });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.limit, 200);
  },
});

checks.push({
  name: "listar_membros lists org A's owner",
  run: async (ctx) => {
    const r = await ctx.call("listar_membros", { organizationId: ctx.orgA.id });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.items.length, 1);
    assert.equal(r.json.items[0].role, "OWNER");
    assert.equal(r.json.items[0].email, ctx.userA.email);
  },
});

checks.push({
  name: "an unknown organizationId is an error that points to listar_organizacoes",
  run: async (ctx) => {
    const r = await ctx.call("resumo_organizacao", { organizationId: "nao-existe" });
    assert.equal(r.isError, true);
    assert.match(r.text, /Organização não encontrada/);
  },
});

/**
 * Last check of every run: each org-scoped tool, called for org A (data with a
 * sentinel in every sensitive field) and org B (empty), with only the
 * organizationId. Nothing sensitive, nothing from the other organization, and
 * no error on an empty organization.
 */
async function sweep(ctx: Ctx): Promise<number> {
  const tools = (await ctx.tools()).filter((t) => "organizationId" in (t.inputSchema.properties ?? {}));
  assert.ok(tools.length > 0, "no org-scoped tool to sweep");
  for (const t of tools) {
    for (const org of [ctx.orgA, ctx.orgB]) {
      const r = await ctx.call(t.name, { organizationId: org.id });
      assert.equal(r.isError, false, `${t.name} (${org.name}): ${r.text}`);
      assert.ok(!r.text.includes(ctx.secret), `${t.name} leaked a sensitive field of ${org.name}`);
      assert.deepEqual(findSensitiveKeys(r.json), [], `${t.name} returned a sensitive key`);
      assert.equal(r.json.organization?.id, org.id, `${t.name} answered for another organization`);
      if (org === ctx.orgB) {
        assert.ok(!r.text.includes(`-A-${ctx.stamp}`), `${t.name} leaked org A data into org B`);
      }
    }
  }
  return tools.length;
}

// ── CRM ──────────────────────────────────────────────────────────────────────

EXPECTED_TOOLS.push(
  "buscar_empresas",
  "buscar_contatos",
  "buscar_oportunidades",
  "buscar_propostas",
  "resumo_vendas",
);

fixtures.push(async (ctx) => {
  const { prisma: db, secret, stamp, userA } = ctx;
  const organizationId = ctx.orgA.id;
  const company = await db.company.create({
    data: {
      organizationId,
      name: `MCP-E2E-A-${stamp} Ltda`,
      notes: secret,
      address: { street: secret, city: "Campinas", uf: "SP" },
    },
  });
  const contact = await db.contact.create({
    data: { organizationId, companyId: company.id, name: `MCP-E2E-A-${stamp} Contato`, email: `contato-${stamp}@test.local` },
  });
  ctx.ids.companyA = company.id;
  ctx.ids.contactA = contact.id;
  const pipeline = await db.pipeline.create({
    data: { organizationId, name: `MCP-E2E-A-${stamp} Funil`, isDefault: true },
  });
  const prospect = await db.stage.create({
    data: { organizationId, pipelineId: pipeline.id, name: "Prospecção", order: 0 },
  });
  const deal = await db.stage.create({
    data: { organizationId, pipelineId: pipeline.id, name: "Negociação", order: 1 },
  });
  const base = {
    organizationId,
    pipelineId: pipeline.id,
    companyId: company.id,
    contactId: contact.id,
    ownerId: userA.id,
    notes: secret,
  };
  await db.opportunity.create({
    data: { ...base, stageId: prospect.id, title: `MCP-E2E-A-${stamp} Aberta`, value: 1000, status: "OPEN" },
  });
  await db.opportunity.create({
    data: { ...base, stageId: deal.id, title: `MCP-E2E-A-${stamp} Ganha`, value: 2500, status: "WON", closedAt: new Date() },
  });
  // Legacy win: no closedAt, so only updatedAt places it in the period.
  await db.opportunity.create({
    data: { ...base, stageId: deal.id, title: `MCP-E2E-A-${stamp} Ganha antiga`, value: 500, status: "WON" },
  });
  await db.opportunity.create({
    data: { ...base, stageId: deal.id, title: `MCP-E2E-A-${stamp} Perdida`, value: 800, status: "LOST", outcomeReason: "Preço" },
  });
  await db.goal.create({
    data: { organizationId, userId: userA.id, month: new Date().toISOString().slice(0, 7), targetValue: 3000 },
  });
  await db.proposal.create({
    data: {
      organizationId,
      title: `MCP-E2E-A-${stamp} Proposta`,
      status: "ACCEPTED",
      subtotal: 2500,
      total: 2500,
      notes: secret,
      intro: secret,
      ownerId: userA.id,
      companyId: company.id,
    },
  });
});

cleanups.push(async (ctx) => {
  const where = inTestOrgs(ctx);
  await ctx.prisma.proposal.deleteMany({ where });
  await ctx.prisma.goal.deleteMany({ where });
  await ctx.prisma.opportunity.deleteMany({ where });
  await ctx.prisma.stage.deleteMany({ where });
  await ctx.prisma.pipeline.deleteMany({ where });
  await ctx.prisma.contact.deleteMany({ where });
  await ctx.prisma.company.deleteMany({ where });
});

checks.push({
  name: "buscar_empresas gives city/uf out of the address (never the address) and contact/open-deal counts",
  run: async (ctx) => {
    const r = await ctx.call("buscar_empresas", { organizationId: ctx.orgA.id, search: "Ltda" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.total, 1);
    const company = r.json.items[0];
    assert.equal(company.city, "Campinas");
    assert.equal(company.uf, "SP");
    assert.equal(company.contactCount, 1);
    assert.equal(company.openOpportunityCount, 1);
    assert.equal("address" in company, false);
  },
});

checks.push({
  name: "buscar_contatos filters by company and names it",
  run: async (ctx) => {
    const r = await ctx.call("buscar_contatos", { organizationId: ctx.orgA.id, companyId: ctx.ids.companyA });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.total, 1);
    assert.equal(r.json.items[0].companyName, `MCP-E2E-A-${ctx.stamp} Ltda`);
  },
});

checks.push({
  name: "buscar_oportunidades filters by status and names the owner",
  run: async (ctx) => {
    const r = await ctx.call("buscar_oportunidades", { organizationId: ctx.orgA.id, status: "WON" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.total, 2);
    for (const o of r.json.items) assert.equal(o.ownerName, ctx.userA.name);
  },
});

checks.push({
  name: "buscar_propostas shows the total as text and the owner's name",
  run: async (ctx) => {
    const r = await ctx.call("buscar_propostas", { organizationId: ctx.orgA.id, status: "ACCEPTED" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.total, 1);
    assert.equal(r.json.items[0].total, "2500.00");
    assert.equal(r.json.items[0].ownerName, ctx.userA.name);
  },
});

checks.push({
  name: "resumo_vendas counts a legacy win without closedAt, the win rate, the goal, losses and the open funnel",
  run: async (ctx) => {
    const r = await ctx.call("resumo_vendas", { organizationId: ctx.orgA.id });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.created.count, 4);
    assert.equal(r.json.won.count, 2);
    assert.equal(r.json.won.value, "3000.00");
    assert.equal(r.json.lost.count, 1);
    assert.equal(r.json.winRate, 0.6667);
    assert.deepEqual(r.json.lossReasons, [{ reason: "Preço", count: 1 }]);
    assert.equal(r.json.byOwner.length, 1);
    assert.equal(r.json.byOwner[0].wonCount, 2);
    assert.equal(r.json.byOwner[0].goal, "3000.00");
    assert.deepEqual(
      r.json.openFunnel.map((s: { stageName: string; count: number; value: string }) => [s.stageName, s.count, s.value]),
      [
        ["Prospecção", 1, "1000.00"],
        ["Negociação", 0, "0.00"],
      ],
    );
  },
});

checks.push({
  name: "resumo_vendas refuses an inverted period, in Portuguese",
  run: async (ctx) => {
    const r = await ctx.call("resumo_vendas", { organizationId: ctx.orgA.id, from: "2026-10-10", to: "2026-10-01" });
    assert.equal(r.isError, true);
    assert.match(r.text, /não pode ser anterior/);
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
    ctx.tools = async () => (await connected.listTools()).tools as ListedTool[];

    for (const check of checks) {
      await check.run(ctx);
      passed++;
      console.log(`  ✓ ${check.name}`);
    }
    const swept = await sweep(ctx);
    passed++;
    console.log(`  ✓ sweep: ${swept} org-scoped tools × orgs A and B — no sensitive field, no cross-org data`);
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
