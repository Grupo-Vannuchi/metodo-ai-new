/**
 * Integration check of the official WhatsApp (Cloud API) campaigns: what test:wa-cloud can't reach, the dispatch against
 * the database and the Graph API. The Graph API is a fake: `fetch` is replaced for the whole run, a call to
 * graph.facebook.com gets the answer the check queued (or a network failure), and a call to any other host is refused.
 * Nothing reaches the Meta: no token, number or message here is real, and the token is a made-up one the Meta would refuse
 * anyway. The server modules (`server-only`, the `@/` alias) load through scripts/tsconfig.server.json.
 *
 * What it proves (review of PR #206, 12/11/2026):
 * - a send with no answer (network failure, HTTP 5xx with no code) may have gone out and been charged: the person is FAILED,
 *   never put back in the queue, and the campaign pauses (or finishes, when it was the last); resumed, it goes on with the
 *   others only; the reservation of a process that died in the middle of the call (over 10 min) is FAILED the same way;
 * - a send the Meta says failed (131000) goes back to the queue, and nothing else changes;
 * - the dev guard holds a number off WHATSAPP_DEV_ALLOWED_NUMBERS before any call, and lets the read receipt through, in
 *   postMessage and in the older channel adapter (channels/meta-cloud.ts);
 * - a company taken off WHATSAPP_CLOUD_ORG_IDS has its running campaign paused, without a call;
 * - only the owner of the number starts a campaign, and one with nobody left in the queue is not sent again.
 *
 * Creates its own data (organization `wcc-e2e-<stamp>`, two users, a number, a template, contacts and campaigns) and ALWAYS
 * deletes it, even on failure. A run that is killed leaves it behind: delete the `wcc-e2e-%` organization by hand. Refuses
 * to run against a database that isn't local.
 *
 * Run: npm run check:wa-cloud:e2e   (needs a valid .env and the Docker Postgres; no internet: the Graph API is a fake)
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";
import { prisma as appPrisma } from "@/lib/prisma";
import {
  cloudCampaignStartProblem,
  dispatchCloudCampaignBatch,
  findCloudCampaign,
  type CloudCampaignLink,
} from "@/lib/whatsapp-cloud/campaign";
import { pauseReasonText, recipientErrorText } from "@/lib/whatsapp-cloud/errors";
import { postMessage } from "@/lib/whatsapp-cloud/meta-api";
import { encryptToken } from "@/lib/whatsapp-cloud/numbers";
import { readPayload, templatePayload } from "@/lib/whatsapp-cloud/payloads";
import { getCloudCampaignInfo } from "@/lib/queries/whatsapp-cloud-campaigns";
import metaCloudAdapter from "@/lib/integrations/channels/meta-cloud";

// ── The fake Graph API ───────────────────────────────────────────────────────

type Reply = { kind: "network" } | { kind: "http"; status: number; body: unknown };
type GraphCall = { path: string; body: Record<string, unknown> | null };

const replies: Reply[] = [];
const calls: GraphCall[] = [];
const refused: string[] = [];

const accepted = (wamid: string, waId: string): Reply => ({
  kind: "http",
  status: 200,
  body: { messaging_product: "whatsapp", contacts: [{ input: waId, wa_id: waId }], messages: [{ id: wamid }] },
});
const metaError = (status: number, code: number, message: string): Reply => ({
  kind: "http",
  status,
  body: { error: { message, code } },
});

function installFakeGraph(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "graph.facebook.com") {
      refused.push(url.hostname);
      throw new Error(`blocked: ${url.hostname}`);
    }
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ path: url.pathname.replace(/^\/v\d+\.\d+/, ""), body });
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected call to the Graph API: ${url.pathname}`);
    if (reply.kind === "network") throw new TypeError("fetch failed");
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

// ── The world ────────────────────────────────────────────────────────────────

const PHONES = ["5511900000101", "5511900000102", "5511900000103"];

type World = { org: string; owner: string; colleague: string; numberId: string; templateId: string; phoneNumberId: string };

function assertLocalDatabase(): void {
  const host = new URL(env.DATABASE_URL).hostname; // never the whole URL: it holds the password
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new Error(
      `check:wa-cloud:e2e creates and deletes a test organization: it only runs against the local Postgres (DATABASE_URL points at ${host}).`,
    );
  }
}

const made = { orgs: [] as string[], users: [] as string[] };

async function createWorld(prisma: PrismaClient): Promise<World> {
  const stamp = Date.now();
  const user = async (tag: string) => {
    const u = await prisma.user.create({
      data: { name: `WCC-E2E-${stamp} ${tag}`, email: `wcc-${tag}-${stamp}@test.local`, passwordHash: "x" },
      select: { id: true },
    });
    made.users.push(u.id);
    return u.id;
  };
  const [owner, colleague] = [await user("owner"), await user("colleague")];
  const org = await prisma.organization.create({
    data: { name: `WCC-E2E-${stamp}`, slug: `wcc-e2e-${stamp}`, ownerId: owner },
    select: { id: true },
  });
  made.orgs.push(org.id);
  await prisma.membership.createMany({
    data: [
      { organizationId: org.id, userId: owner, role: "OWNER" },
      { organizationId: org.id, userId: colleague, role: "MEMBER" },
    ],
  });
  const phoneNumberId = `wcc-pn-${stamp}`;
  const number = await prisma.whatsappCloudNumber.create({
    data: {
      organizationId: org.id,
      ownerId: owner,
      phoneNumberId,
      wabaId: `wcc-waba-${stamp}`,
      accessTokenEnc: encryptToken("wcc-e2e-not-a-token"),
      status: "ACTIVE",
    },
    select: { id: true },
  });
  const template = await prisma.whatsappCloudTemplate.create({
    data: {
      organizationId: org.id,
      wabaId: `wcc-waba-${stamp}`,
      metaId: `wcc-tpl-${stamp}`,
      name: "boas_vindas",
      language: "pt_BR",
      category: "UTILITY",
      status: "APPROVED",
      parameterFormat: "POSITIONAL",
      components: [{ type: "BODY", text: "Olá! Este é um teste." }],
      syncedAt: new Date(),
    },
    select: { id: true },
  });
  return { org: org.id, owner, colleague, numberId: number.id, templateId: template.id, phoneNumberId };
}

let campaignNo = 0;

/** A RUNNING official campaign of the owner's number, with one PENDING recipient per phone. */
async function makeCampaign(prisma: PrismaClient, w: World, phones: string[]): Promise<CloudCampaignLink> {
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: w.org,
      name: `WCC campanha ${++campaignNo}`,
      channel: "WHATSAPP_CLOUD",
      status: "RUNNING",
      createdById: w.owner,
    },
    select: { id: true },
  });
  for (const [i, phone] of phones.entries()) {
    const contact = await prisma.contact.create({
      data: { organizationId: w.org, name: `WCC contato ${campaignNo}.${i}`, phone },
      select: { id: true },
    });
    await prisma.campaignRecipient.create({
      data: { organizationId: w.org, campaignId: campaign.id, contactId: contact.id },
    });
  }
  await prisma.whatsappCloudCampaign.create({
    data: { organizationId: w.org, campaignId: campaign.id, numberId: w.numberId, templateId: w.templateId, params: {} },
  });
  const link = await findCloudCampaign(w.org, campaign.id);
  assert.ok(link, "the campaign link is found");
  return link;
}

/** The recipients of a campaign, in order, as the checks compare them. */
async function recipientsOf(prisma: PrismaClient, campaignId: string) {
  const rows = await prisma.campaignRecipient.findMany({
    where: { campaignId },
    orderBy: { id: "asc" },
    select: { status: true, error: true, sentAt: true, providerMessageId: true, contact: { select: { phone: true } } },
  });
  return rows.map((r) => ({ phone: r.contact.phone, status: r.status, error: r.error, sentAt: r.sentAt, wamid: r.providerMessageId }));
}

async function campaignState(prisma: PrismaClient, campaignId: string) {
  const c = await prisma.campaign.findFirst({ where: { id: campaignId }, select: { status: true } });
  const l = await prisma.whatsappCloudCampaign.findFirst({ where: { campaignId }, select: { pausedReason: true } });
  return { status: c?.status, pausedReason: l?.pausedReason ?? null };
}

/** The phone each send went to, in order. */
const sentTo = () => calls.map((c) => c.body?.to);

async function destroyWorld(prisma: PrismaClient): Promise<void> {
  const where = { organizationId: { in: made.orgs } };
  await prisma.whatsappCloudCampaign.deleteMany({ where });
  await prisma.campaign.deleteMany({ where }); // recipients go with their campaign (onDelete: Cascade)
  await prisma.whatsappCloudTemplate.deleteMany({ where });
  await prisma.whatsappCloudNumber.deleteMany({ where }); // conversations and messages go with the number
  await prisma.contact.deleteMany({ where });
  await prisma.membership.deleteMany({ where });
  await prisma.organization.deleteMany({ where: { id: { in: made.orgs } } });
  await prisma.user.deleteMany({ where: { id: { in: made.users } } });
}

// ── The checks ───────────────────────────────────────────────────────────────

type Ctx = { prisma: PrismaClient; w: World };
const checks: { name: string; run: (ctx: Ctx) => Promise<void> }[] = [];
const check = (name: string, run: (ctx: Ctx) => Promise<void>) => void checks.push({ name, run });

check("an accepted send is SENT with the wamid, goes to the phone of the contact and finishes the campaign", async ({ prisma, w }) => {
  const link = await makeCampaign(prisma, w, [PHONES[0]]);
  replies.push(accepted("wamid.ok1", PHONES[0]));
  const res = await dispatchCloudCampaignBatch(link);
  assert.deepEqual(res, { done: true });
  assert.deepEqual(sentTo(), [PHONES[0]]);
  assert.equal(calls[0].path, `/${w.phoneNumberId}/messages`);
  const [r] = await recipientsOf(prisma, link.campaignId);
  assert.equal(r.status, "SENT");
  assert.equal(r.wamid, "wamid.ok1");
  assert.equal((await campaignState(prisma, link.campaignId)).status, "DONE");
});

check("no answer (network failure): the person is FAILED and never resent, the campaign pauses, the others wait", async ({ prisma, w }) => {
  const link = await makeCampaign(prisma, w, [PHONES[0], PHONES[1]]);
  replies.push({ kind: "network" });
  const res = await dispatchCloudCampaignBatch(link);
  assert.deepEqual(res, { done: true });
  assert.deepEqual(sentTo(), [PHONES[0]], "one call, and no second try of the same person");
  const [first, second] = await recipientsOf(prisma, link.campaignId);
  assert.equal(first.status, "FAILED");
  assert.equal(first.error, recipientErrorText("uncertain", "fetch failed"));
  assert.equal(second.status, "PENDING");
  assert.equal(second.sentAt, null, "the second person was never reserved");
  assert.deepEqual(await campaignState(prisma, link.campaignId), { status: "PAUSED", pausedReason: pauseReasonText("uncertain") });

  // Resumed (what startCampaign does: RUNNING again), it goes on with the second person only.
  await prisma.campaign.updateMany({ where: { id: link.campaignId }, data: { status: "RUNNING" } });
  calls.length = 0;
  replies.push(accepted("wamid.after", PHONES[1]));
  assert.deepEqual(await dispatchCloudCampaignBatch(link), { done: true });
  assert.deepEqual(sentTo(), [PHONES[1]], "the uncertain person is not sent again");
  const after = await recipientsOf(prisma, link.campaignId);
  assert.deepEqual(after.map((r) => r.status), ["FAILED", "SENT"]);
});

check("no answer for the last person in the queue: FAILED, not resent, and the campaign finishes instead of pausing for ever", async ({ prisma, w }) => {
  const link = await makeCampaign(prisma, w, [PHONES[0]]);
  replies.push({ kind: "network" });
  assert.deepEqual(await dispatchCloudCampaignBatch(link), { done: true });
  assert.equal(calls.length, 1);
  assert.deepEqual((await recipientsOf(prisma, link.campaignId)).map((r) => r.status), ["FAILED"]);
  assert.equal((await campaignState(prisma, link.campaignId)).status, "DONE");
});

check("a reservation of a process that died (over 10 min) is FAILED as uncertain with no call; a live one is left alone", async ({ prisma, w }) => {
  const link = await makeCampaign(prisma, w, [PHONES[0], PHONES[1], PHONES[2]]);
  const [stale, live] = await prisma.campaignRecipient.findMany({
    where: { campaignId: link.campaignId },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);
  await prisma.campaignRecipient.updateMany({ where: { id: stale.id }, data: { sentAt: minutesAgo(11) } });
  await prisma.campaignRecipient.updateMany({ where: { id: live.id }, data: { sentAt: minutesAgo(1) } });
  replies.push(accepted("wamid.fresh", PHONES[2]));
  const res = await dispatchCloudCampaignBatch(link);
  assert.equal(res.done, false, "the live reservation is still in flight: the campaign is not over");
  assert.deepEqual(sentTo(), [PHONES[2]], "only the person nobody had reserved was sent");
  const rows = await recipientsOf(prisma, link.campaignId);
  assert.deepEqual(rows.map((r) => r.status), ["FAILED", "PENDING", "SENT"]);
  assert.equal(rows[0].error, recipientErrorText("uncertain", null));
  assert.equal(rows[0].sentAt, null);
  assert.notEqual(rows[1].sentAt, null, "the live reservation keeps its stamp");
  assert.equal((await campaignState(prisma, link.campaignId)).status, "RUNNING");
});

check("an HTTP 5xx with no code is uncertain too: FAILED, not resent, campaign paused", async ({ prisma, w }) => {
  const link = await makeCampaign(prisma, w, [PHONES[0], PHONES[1]]);
  replies.push({ kind: "http", status: 503, body: "Service Unavailable" });
  await dispatchCloudCampaignBatch(link);
  assert.equal(calls.length, 1);
  assert.deepEqual((await recipientsOf(prisma, link.campaignId)).map((r) => r.status), ["FAILED", "PENDING"]);
  assert.equal((await campaignState(prisma, link.campaignId)).status, "PAUSED");
});

check("the Meta says it failed (131000): back to the queue, retried later, nothing else changes", async ({ prisma, w }) => {
  const link = await makeCampaign(prisma, w, [PHONES[0], PHONES[1]]);
  replies.push(metaError(500, 131000, "Something went wrong"));
  const res = await dispatchCloudCampaignBatch(link);
  assert.deepEqual(res, { done: false, retryAfter: 60 });
  assert.equal(calls.length, 1);
  const rows = await recipientsOf(prisma, link.campaignId);
  assert.deepEqual(rows.map((r) => [r.status, r.sentAt]), [["PENDING", null], ["PENDING", null]]);
  assert.deepEqual(await campaignState(prisma, link.campaignId), { status: "RUNNING", pausedReason: null });
});

check("the dev guard holds a number off the list before any call; the others on the list go out", async ({ prisma, w }) => {
  env.WHATSAPP_DEV_ALLOWED_NUMBERS = [PHONES[0], PHONES[2]].join(",");
  const link = await makeCampaign(prisma, w, [PHONES[0], PHONES[1], PHONES[2]]);
  replies.push(accepted("wamid.g1", PHONES[0]), accepted("wamid.g3", PHONES[2]));
  assert.deepEqual(await dispatchCloudCampaignBatch(link), { done: true });
  assert.deepEqual(sentTo(), [PHONES[0], PHONES[2]], "nothing was sent to the number off the list");
  const rows = await recipientsOf(prisma, link.campaignId);
  assert.deepEqual(rows.map((r) => r.status), ["SENT", "FAILED", "SENT"]);
  assert.equal(rows[1].error, recipientErrorText("dev_guard", null));
});

check("the dev guard: an empty list holds every send, a BSUID-only one too; the read receipt still goes", async () => {
  env.WHATSAPP_DEV_ALLOWED_NUMBERS = "";
  const held = await postMessage("pn", "token", templatePayload({ waId: PHONES[0], bsuid: null }, "x", "pt_BR", []));
  assert.equal(held.ok, false);
  assert.equal(!held.ok && held.heldByDevGuard, true);
  const bsuid = await postMessage("pn", "token", templatePayload({ waId: null, bsuid: "BR.123" }, "x", "pt_BR", []));
  assert.equal(!bsuid.ok && bsuid.heldByDevGuard, true);
  assert.equal(calls.length, 0, "no held send reached the Graph API");
  replies.push({ kind: "http", status: 200, body: { success: true } });
  const read = await postMessage("pn", "token", readPayload("wamid.x"));
  assert.equal(read.ok, true);
  assert.equal(calls.length, 1);
});

check("the older channel adapter (channels/meta-cloud.ts) is held by the dev guard too", async () => {
  const creds = { phoneNumberId: "pn-old", accessToken: "wcc-e2e-not-a-token" };
  const held = await metaCloudAdapter.send(creds, { to: "5511988887777", body: "x" });
  assert.equal(held.ok, false);
  assert.match(held.error ?? "", /WHATSAPP_DEV_ALLOWED_NUMBERS/);
  assert.equal(calls.length, 0, "the number off the list never reached the Graph API");
  replies.push(accepted("wamid.old", PHONES[0]));
  const sent = await metaCloudAdapter.send(creds, { to: PHONES[0], body: "x" });
  assert.deepEqual(sent, { ok: true, providerMessageId: "wamid.old" });
  assert.deepEqual(sentTo(), [PHONES[0]]);
  assert.equal(calls[0].path, "/pn-old/messages");
});

check("a company taken off WHATSAPP_CLOUD_ORG_IDS: its running campaign pauses with no call, the queue untouched", async ({ prisma, w }) => {
  const link = await makeCampaign(prisma, w, [PHONES[0]]);
  env.WHATSAPP_CLOUD_ORG_IDS = "";
  assert.deepEqual(await dispatchCloudCampaignBatch(link), { done: true });
  assert.equal(calls.length, 0);
  const state = await campaignState(prisma, link.campaignId);
  assert.equal(state.status, "PAUSED");
  assert.match(state.pausedReason ?? "", /piloto/);
  assert.deepEqual((await recipientsOf(prisma, link.campaignId)).map((r) => [r.status, r.sentAt]), [["PENDING", null]]);
  assert.equal(await cloudCampaignStartProblem(link, w.owner), "not_enabled", "and it can't be resumed while off the list");
});

check("only the owner of the number starts or resumes; one with nobody in the queue is not sent again", async ({ prisma, w }) => {
  const link = await makeCampaign(prisma, w, [PHONES[0]]);
  assert.equal(await cloudCampaignStartProblem(link, w.colleague), "not_owner");
  assert.equal(await cloudCampaignStartProblem(link, w.owner), null);
  const info = await getCloudCampaignInfo(w.org, link.campaignId);
  assert.equal(info?.numberOwnerId, w.owner, "the page knows who may start it");

  replies.push(accepted("wamid.once", PHONES[0]));
  await dispatchCloudCampaignBatch(link);
  assert.equal(await cloudCampaignStartProblem(link, w.owner), "already_sent");
  // Even a campaign whose every person FAILED is not sent again: a new campaign is.
  const failed = await makeCampaign(prisma, w, [PHONES[1]]);
  await prisma.campaignRecipient.updateMany({ where: { campaignId: failed.campaignId }, data: { status: "FAILED" } });
  assert.equal(await cloudCampaignStartProblem(failed, w.owner), "already_sent");
});

check("a number that is not ACTIVE, or a template that is not APPROVED, can't start", async ({ prisma, w }) => {
  const link = await makeCampaign(prisma, w, [PHONES[0]]);
  await prisma.whatsappCloudTemplate.updateMany({ where: { id: w.templateId }, data: { status: "PAUSED" } });
  assert.equal(await cloudCampaignStartProblem(link, w.owner), "invalid");
  await prisma.whatsappCloudTemplate.updateMany({ where: { id: w.templateId }, data: { status: "APPROVED" } });
  await prisma.whatsappCloudNumber.updateMany({ where: { id: w.numberId }, data: { status: "ERROR" } });
  assert.equal(await cloudCampaignStartProblem(link, w.owner), "no_connection");
  await prisma.whatsappCloudNumber.updateMany({ where: { id: w.numberId }, data: { status: "ACTIVE" } });
});

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  assertLocalDatabase();
  const saved = {
    allowed: env.WHATSAPP_DEV_ALLOWED_NUMBERS,
    pilot: env.WHATSAPP_CLOUD_ORG_IDS,
    nodeEnv: env.NODE_ENV,
  };
  // The guard is what the checks look at: never production here, whatever .env holds.
  env.NODE_ENV = "development";
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  const undoFetch = installFakeGraph();
  let passed = 0;
  try {
    // The control of the fake: another host is refused before anything leaves the machine.
    await assert.rejects(() => fetch("https://example.invalid/"), /blocked/);
    assert.deepEqual(refused.splice(0), ["example.invalid"]);
    const w = await createWorld(prisma);
    for (const c of checks) {
      // Each check starts from the same place: the company in the pilot, every phone of the checks on the dev list.
      env.WHATSAPP_CLOUD_ORG_IDS = w.org;
      env.WHATSAPP_DEV_ALLOWED_NUMBERS = PHONES.join(",");
      replies.length = 0;
      calls.length = 0;
      await c.run({ prisma, w });
      assert.deepEqual(replies, [], "a queued answer of the fake was never asked for");
      assert.deepEqual(refused, [], "a request went to a host that isn't the (fake) Graph API");
      passed++;
      console.log(`  ✓ ${c.name}`);
    }
    return passed;
  } finally {
    undoFetch();
    env.WHATSAPP_DEV_ALLOWED_NUMBERS = saved.allowed;
    env.WHATSAPP_CLOUD_ORG_IDS = saved.pilot;
    env.NODE_ENV = saved.nodeEnv;
    await destroyWorld(prisma).catch((e) => console.error("cleanup failed:", e instanceof Error ? e.message : "unknown error"));
    await prisma.$disconnect();
    await appPrisma.$disconnect();
  }
}

main()
  .then((passed) => console.log(`\ncheck:wa-cloud:e2e — ${passed} checks passed`))
  .catch((e) => {
    console.error("\nWA-CLOUD E2E CHECK FAILED:", e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
    process.exit(1);
  });
