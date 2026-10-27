/**
 * End-to-end check of the WhatsApp automation (menu of options + start with any
 * message) against a running `next dev` — http://localhost:3000 unless
 * AUTOMATION_E2E_URL says otherwise.
 *
 * Creates its own organization in the local Postgres with a fake Evolution
 * connection, posts `messages.upsert` webhooks as the lead would, and reads
 * what the bot "sends" from a fake Evolution server on :4999
 * (AUTOMATION_E2E_EVO_PORT). Nothing reaches WhatsApp. ALWAYS deletes what it
 * created, even on failure.
 *
 * Run: npm run check:automation:e2e   (needs the Docker Postgres and `next dev`
 * on :3000 — use `npx next dev --webpack` if Turbopack answers 404 on /api).
 * Each turn waits out the 8 s debounce, so it takes about two minutes.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { createCipheriv, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { formatMenu, invalidMenuReply } from "../src/lib/automation/menu";

// `engineType = "client"` (schema.prisma) drops the Rust engine, so every
// PrismaClient needs an explicit driver adapter — same as src/lib/prisma.ts.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const ENC_KEY = process.env.INTEGRATION_ENC_KEY;
if (!ENC_KEY) throw new Error("INTEGRATION_ENC_KEY is not set");
const BASE = process.env.AUTOMATION_E2E_URL ?? "http://localhost:3000";
const EVO_PORT = Number(process.env.AUTOMATION_E2E_EVO_PORT ?? 4999);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const stamp = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Same format as encryptCredentials (src/lib/integrations/crypto.ts, server-only). */
function encrypt(creds: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(ENC_KEY!, "hex"), iv);
  const data = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(creds), "utf8")), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

// ── Fake Evolution: records every text the bot sends, per number ─────────────

const sent = new Map<string, string[]>();
const evo = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.method === "POST" && req.url?.startsWith("/message/sendText/")) {
      const { number, text } = JSON.parse(body || "{}") as { number?: string; text?: string };
      const key = String(number ?? "").slice(-8);
      sent.set(key, [...(sent.get(key) ?? []), String(text ?? "")]);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ key: { id: `FAKE${stamp}${Math.random().toString(36).slice(2)}` } }));
      return;
    }
    res.writeHead(404).end();
  });
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const LABELS = ["Evento X", "Evento Y", "Falar com um atendente"];
const options = [
  {
    label: "Evento X",
    questions: [{ label: "Qual o seu nome?", field: "name" }, { label: "Quantos ingressos?", field: "notes" }],
    finalMessage: "FX",
  },
  { label: "Evento Y", questions: [{ label: "Qual a empresa?", field: "notes" }], finalMessage: "FY" },
  { label: "Falar com um atendente", questions: [], finalMessage: "FA" },
];
const MENU_KW = formatMenu("Qual evento (kw)?", LABELS);
const MENU_ANY = formatMenu("Qual evento?", LABELS);
const INVALID = invalidMenuReply(LABELS);
const DEFAULT_FINAL = "Obrigado! Recebemos suas informações.";

type Fx = { orgId: string; connId: string; token: string; ruleAnyId: string };
let fx: Fx | null = null;

async function setup(): Promise<Fx> {
  const org = await prisma.organization.create({ data: { name: `E2E automação ${stamp}`, slug: `e2e-automacao-${stamp}` } });
  const orgId = org.id;
  await prisma.organizationModule.create({ data: { organizationId: orgId, moduleId: "inbox", status: "ACTIVE" } });
  const pipeline = await prisma.pipeline.create({ data: { organizationId: orgId, name: "Funil", isDefault: true } });
  await prisma.stage.create({ data: { organizationId: orgId, pipelineId: pipeline.id, name: "Novo", order: 0 } });
  const token = `tok${stamp}`;
  const conn = await prisma.integrationConnection.create({
    data: {
      organizationId: orgId,
      provider: "EVOLUTION",
      label: "E2E",
      status: "ACTIVE",
      credentialsEnc: encrypt({ baseUrl: `http://localhost:${EVO_PORT}`, apiKey: "e2e", instance: "e2e" }),
      meta: { webhookToken: token },
    },
  });
  const wa = (extra: object) => ({ whatsapp: { connectionId: conn.id, match: "contains", ...extra } });
  const rule = (name: string, actions: object[], config: object) =>
    prisma.automationRule.create({ data: { organizationId: orgId, name, trigger: "whatsapp_message", actions, config } });
  // Created in this order on purpose: rules are matched oldest first.
  await rule("E2E kw", [{ type: "ask_menu", firstMessage: "BV-KW", question: "Qual evento (kw)?", options }, { type: "create_opportunity" }], wa({ start: "keyword", keyword: "evento" }));
  const any = await rule("E2E any", [{ type: "ask_menu", firstMessage: "BV-ANY", question: "Qual evento?", options }, { type: "create_opportunity" }], wa({ start: "any", keyword: "" }));
  // Saved the way rules were before `start` existed.
  await rule("E2E old", [{ type: "ask_questions", questions: [{ label: "Para quando?", field: "notes" }] }, { type: "create_opportunity" }], wa({ keyword: "orcamento" }));
  return { orgId, connId: conn.id, token, ruleAnyId: any.id };
}

/** Deletes every row of one test org from every table that has organizationId. */
async function deleteOrg(orgId: string): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT DISTINCT table_name::text AS t FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organizationId'`,
  );
  let left = tables.map((r) => r.t);
  for (let pass = 0; pass < 5 && left.length; pass++) {
    const failed: string[] = [];
    for (const t of left) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "organizationId" = $1`, orgId);
      } catch {
        failed.push(t);
      }
    }
    left = failed;
  }
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

/** This run's org, plus any left behind by a run that was killed mid-way. */
async function cleanup(): Promise<void> {
  const stale = await prisma.organization.findMany({ where: { slug: { startsWith: "e2e-automacao-" } }, select: { id: true } });
  for (const o of stale) await deleteOrg(o.id);
}

// ── The lead's side ─────────────────────────────────────────────────────────

let seq = 0;
type Lead = { name: string; num: string; jid: string; seen: number };
function lead(name: string, idx: number): Lead {
  const num = `55119${String(stamp % 1_000_000).padStart(6, "0")}${String(idx).padStart(2, "0")}`;
  return { name, num, jid: `${num}@s.whatsapp.net`, seen: 0 };
}
const outbox = (l: Lead) => sent.get(l.num.slice(-8)) ?? [];

async function say(l: Lead, text: string): Promise<void> {
  const payload = {
    event: "messages.upsert",
    instance: "e2e",
    data: {
      key: { remoteJid: l.jid, fromMe: false, id: `E2E${stamp}${++seq}` },
      pushName: `Lead ${l.name}`,
      message: { conversation: text },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  };
  const res = await fetch(`${BASE}/api/webhooks/evolution/${fx!.connId}/${fx!.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 200, `[${l.name}] webhook answered ${res.status}`);
}

/** The bot's next replies to this lead, exactly — and nothing right after them. */
async function expectReplies(l: Lead, texts: string[], timeoutMs = 25_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (outbox(l).length < l.seen + texts.length && Date.now() < until) await sleep(250);
  await sleep(1500);
  const got = outbox(l).slice(l.seen);
  assert.deepEqual(got, texts, `[${l.name}] bot replies`);
  l.seen += got.length;
}

async function expectSilence(l: Lead, ms = 14_000): Promise<void> {
  await sleep(ms);
  assert.deepEqual(outbox(l).slice(l.seen), [], `[${l.name}] the bot should stay quiet`);
}

const conversationOf = (l: Lead) =>
  prisma.conversation.findFirstOrThrow({ where: { organizationId: fx!.orgId, remoteJid: l.jid } });
async function sessionsOf(l: Lead) {
  const c = await conversationOf(l);
  return prisma.automationSession.findMany({ where: { organizationId: fx!.orgId, conversationId: c.id }, orderBy: { createdAt: "asc" } });
}
async function opportunityOf(l: Lead) {
  const c = await conversationOf(l);
  assert.ok(c.contactId, `[${l.name}] conversation has a contact`);
  const contact = await prisma.contact.findFirstOrThrow({ where: { organizationId: fx!.orgId, id: c.contactId } });
  const opp = await prisma.opportunity.findFirst({ where: { organizationId: fx!.orgId, contactId: contact.id } });
  assert.ok(opp, `[${l.name}] opportunity created`);
  return { contact, opp };
}

/** A conversation that already exists, with one message from the team `ago` ms back. */
async function seedConversation(l: Lead, opts: { outboundAgo?: number; assignedToId?: string }): Promise<void> {
  const conv = await prisma.conversation.create({
    data: { organizationId: fx!.orgId, connectionId: fx!.connId, remoteJid: l.jid, assignedToId: opts.assignedToId ?? null },
  });
  if (opts.outboundAgo !== undefined) await teamMessage(conv.id, opts.outboundAgo);
}
async function teamMessage(conversationId: string, ago: number): Promise<void> {
  const at = new Date(Date.now() - ago);
  await prisma.message.create({
    data: { organizationId: fx!.orgId, conversationId, direction: "OUTBOUND", type: "TEXT", body: "Mensagem da equipe", fromMe: true, agentReply: false, timestamp: at, createdAt: at },
  });
}
async function expireOpenSession(l: Lead): Promise<void> {
  const c = await conversationOf(l);
  await prisma.automationSession.updateMany({
    where: { organizationId: fx!.orgId, conversationId: c.id, status: "ACTIVE" },
    data: { lastInboundAt: new Date(Date.now() - 25 * HOUR) },
  });
}

// ── Cases ───────────────────────────────────────────────────────────────────

const cases: Record<string, (l: Lead) => Promise<void>> = {
  // Keyword rule wins over the any-message rule; menu → option 2 → its question → its final message.
  async A(l) {
    await say(l, "quero falar do evento");
    await expectReplies(l, ["BV-KW", MENU_KW]);
    await say(l, "2.");
    await expectReplies(l, ["Qual a empresa?"]);
    await say(l, "ACME");
    await expectReplies(l, ["FY"]);
    const { contact, opp } = await opportunityOf(l);
    assert.equal(opp!.title, `E2E kw · Evento Y · ${contact.name}`);
    assert.ok(opp!.notes?.startsWith("Opção escolhida: Evento Y\nQual a empresa?: ACME"), opp!.notes ?? "");
  },
  // Any message on a new conversation; an invalid answer repeats the menu; emoji picks option 1.
  async B(l) {
    await say(l, "Oi");
    await expectReplies(l, ["BV-ANY", MENU_ANY]);
    await say(l, "o de sábado");
    await expectReplies(l, [INVALID]);
    await say(l, "1️⃣");
    await expectReplies(l, ["Qual o seu nome?"]);
    await say(l, "Ana");
    await expectReplies(l, ["Quantos ingressos?"]);
    await say(l, "3");
    await expectReplies(l, ["FX"]);
    const { contact, opp } = await opportunityOf(l);
    assert.equal(contact.name, "Ana");
    assert.equal(opp!.title, "E2E any · Evento X · Ana");
  },
  // An option without questions ends right away; "obrigado" afterwards doesn't restart it.
  async C(l) {
    await say(l, "Oi");
    await expectReplies(l, ["BV-ANY", MENU_ANY]);
    await say(l, "falar com um atendente");
    await expectReplies(l, ["FA"]);
    assert.deepEqual((await sessionsOf(l)).map((s) => s.status), ["COMPLETED"]);
    await say(l, "obrigado");
    await expectSilence(l);
  },
  // The team wrote 2 days ago: any message doesn't start.
  async D(l) {
    await seedConversation(l, { outboundAgo: 2 * DAY });
    await say(l, "Oi");
    await expectSilence(l);
    assert.equal((await sessionsOf(l)).length, 0);
  },
  // Assigned to someone: any message doesn't start.
  async E(l) {
    await seedConversation(l, { assignedToId: `e2e-user-${stamp}` });
    await say(l, "Oi");
    await expectSilence(l);
  },
  // Quiet for 8 days: any message starts.
  async F(l) {
    await seedConversation(l, { outboundAgo: 8 * DAY });
    await say(l, "Oi");
    await expectReplies(l, ["BV-ANY", MENU_ANY]);
  },
  // Abandoned the menu for 25 h: the next message restarts the flow.
  async G(l) {
    await say(l, "Oi");
    await expectReplies(l, ["BV-ANY", MENU_ANY]);
    await expireOpenSession(l);
    await say(l, "2");
    await expectReplies(l, ["BV-ANY", MENU_ANY]);
    assert.deepEqual((await sessionsOf(l)).map((s) => s.status), ["EXPIRED", "ACTIVE"]);
  },
  // Same, but a person wrote after the menu: no restart.
  async H(l) {
    await say(l, "Oi");
    await expectReplies(l, ["BV-ANY", MENU_ANY]);
    await expireOpenSession(l);
    await teamMessage((await conversationOf(l)).id, 0);
    await say(l, "2");
    await expectSilence(l);
  },
  // A burst at the start: one welcome, one menu, one session.
  async J(l) {
    await say(l, "Oi");
    await sleep(1000);
    await say(l, "tudo bem?");
    await expectReplies(l, ["BV-ANY", MENU_ANY]);
    assert.equal((await sessionsOf(l)).filter((s) => s.status === "ACTIVE").length, 1);
    await say(l, "2");
    await expectReplies(l, ["Qual a empresa?"]);
  },
  // A rule saved before the menu works as before.
  async L(l) {
    await say(l, "orcamento");
    await expectReplies(l, ["Para quando?"]);
    await say(l, "sexta");
    await expectReplies(l, [DEFAULT_FINAL]);
    const { opp } = await opportunityOf(l);
    assert.equal(opp!.notes, 'Para quando?: sexta\nOrigem: WhatsApp (automação "E2E old")');
  },
};

// Runs alone at the end: it edits the shared any-message rule.
async function caseK(l: Lead): Promise<void> {
  await say(l, "Oi");
  await expectReplies(l, ["BV-ANY", MENU_ANY]);
  await say(l, "2");
  await expectReplies(l, ["Qual a empresa?"]);
  const swapped = [options[1], options[0], options[2]];
  await prisma.automationRule.updateMany({
    where: { organizationId: fx!.orgId, id: fx!.ruleAnyId },
    data: { actions: [{ type: "ask_menu", firstMessage: "BV-ANY", question: "Qual evento?", options: swapped }, { type: "create_opportunity" }] },
  });
  await say(l, "ACME");
  await expectReplies(l, ["BV-ANY", formatMenu("Qual evento?", swapped.map((o) => o.label))]);
  assert.deepEqual((await sessionsOf(l)).map((s) => s.status), ["CANCELED", "ACTIVE"]);
}

async function main(): Promise<void> {
  await new Promise<void>((resolve) => evo.listen(EVO_PORT, resolve));
  await cleanup();
  fx = await setup();
  const names = Object.keys(cases);
  const results = await Promise.allSettled(
    names.map((n, i) => cases[n](lead(n, i + 1)).then(() => console.log(`  ✓ ${n}`))),
  );
  const failed = results.flatMap((r, i) => (r.status === "rejected" ? [`${names[i]}: ${(r.reason as Error).message}`] : []));
  if (!failed.length) {
    await caseK(lead("K", 99));
    console.log("  ✓ K");
  }
  if (failed.length) throw new Error(`${failed.length} case(s) failed:\n${failed.join("\n\n")}`);
  console.log(`\n✅ automation e2e: ${names.length + 1} cases passed.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed", e));
    evo.close();
    await prisma.$disconnect();
  });
