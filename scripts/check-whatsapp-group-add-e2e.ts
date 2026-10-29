/**
 * Integration check of "Adicionar a grupo do WhatsApp" (spec 2026-10-28): what check:group-add can't reach, the server
 * code that talks to Evolution and to the database. It runs against a fake Evolution on loopback
 * (scripts/shims/fake-evolution.ts), so nothing reaches WhatsApp and no number, group or message is real, and against the
 * local Postgres. The server modules (`server-only`, the `@/` alias) load through scripts/tsconfig.server.json.
 *
 * Creates its own data: two organizations (`wga-e2e-<stamp>` and `wga-e2e-<stamp>-b`) with their users, memberships and an
 * Evolution connection each, and ALWAYS deletes them (runs and their items, contacts, folders, connections, memberships,
 * users, organizations), even on failure. A run that is killed (Ctrl+C, a timeout) leaves them behind: delete the
 * `wga-e2e-%` organizations by hand. Refuses to run against a database that isn't local. Every connection points at the
 * fake on loopback and the script refuses any request to another host, so the real Evolution of .env is never reached.
 * The queue (QStash) and after() are never reached either: the runner's scheduler is replaced by a capture the checks run
 * themselves, and its clock by one the checks move (sleeping only moves it). The check of the queue job points the QStash
 * client at a fake of its own on loopback. The cron route is called with a secret of the checks, set in `env` for the run.
 * The route reads every run of the database, so the checks that call it as authorized stand down (and say so) when a run
 * outside the throwaway organizations is open.
 *
 * Run: npm run check:group-add:e2e   (needs a valid .env and the Docker Postgres; no internet: the fake is on loopback)
 * Exits non-zero on the first failure. Every check starts a fake of its own and it is closed when the check ends.
 *
 * Later tasks add their checks with check(...) above main().
 */
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { inspect } from "node:util";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { GET as cronWhatsappGroups } from "@/app/api/cron/whatsapp-groups/route";
import { env } from "@/lib/env";
import { JOB_HANDLERS } from "@/lib/jobs";
import { prisma as appPrisma } from "@/lib/prisma";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto";
import {
  addGroupParticipant,
  checkOnWhatsapp,
  connectionState,
  fetchAllGroups,
  fetchGroupInviteUrl,
  fetchGroupSummary,
  fetchOwnerJid,
  sendPlainText,
  type EvoCreds,
} from "@/lib/integrations/evolution-client";
import { forecastFinish, phoneMatchKey, renderInvite, type GroupAddItemStatus } from "@/lib/whatsapp/group-add/core";
import {
  findDueGroupAddRuns,
  groupAddRuntime,
  kickGroupAddRun,
  promoteQueuedRuns,
  runGroupAddRun,
} from "@/lib/whatsapp/group-add/runner";
import {
  cancelGroupAdd,
  forecastGroupAddRun,
  listMyGroups,
  pauseGroupAdd,
  pokeGroupAdd,
  previewGroupAdd,
  resumeGroupAdd,
  startGroupAdd,
  type GroupAddSource,
} from "@/lib/whatsapp/group-add/service";
import { getGroupAddRunView, listContactGroupAdds } from "@/lib/queries/whatsapp-group-add";
import {
  FAKE_EVO_GROUP,
  FAKE_EVO_GROUP_JID,
  FAKE_EVO_OWNER_JID,
  FAKE_EVO_ROUTES,
  listenFakeEvolution,
  type FakeEvoCall,
  type FakeEvoReply,
  type FakeEvolution,
} from "./shims/fake-evolution";

type StartedFake = FakeEvolution & { creds: EvoCreds };

type Ctx = {
  /** A fake Evolution of this check's own, closed when the check ends (pass or fail). `instance` is the name in the credentials. */
  startFake: (instance?: string) => Promise<StartedFake>;
  /** The throwaway organizations, users and connections of this run (the database checks use them). */
  world: World;
};

/** Each task below registers its checks with check(); main() runs them in order. */
const checks: { name: string; run: (ctx: Ctx) => Promise<void> }[] = [];

function check(name: string, run: (ctx: Ctx) => Promise<void> | void): void {
  checks.push({ name, run: async (ctx) => run(ctx) });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const GROUP = FAKE_EVO_GROUP_JID;
const PERSON = "5511987654321";
const INVITE_LINK = "https://chat.whatsapp.com/AbC";
const INVITE_TEXT = `Oi Ana! Este é o link para entrar no grupo Ofertas:\n\n${INVITE_LINK}`;

/** The fake's group as the client has to give it back: the LID with a number resolved, the one without counted. */
const OFERTAS = {
  jid: GROUP,
  subject: "Ofertas",
  size: 3,
  announce: true,
  participants: [
    { number: "5511987654321", admin: true },
    { number: "5511912345678", admin: false },
  ],
  unresolved: 1,
};

/** The calls the fake got, as the checks compare them. */
const seen = (fake: FakeEvolution) => fake.calls.map(({ method, path, query, body }) => ({ method, path, query, body }));

/** One call of each new function, in the order of the interface. */
async function tour(creds: EvoCreds) {
  return {
    groups: await fetchAllGroups(creds),
    summary: await fetchGroupSummary(creds, GROUP),
    owner: await fetchOwnerJid(creds),
    add: await addGroupParticipant(creds, GROUP, PERSON),
    exists: await checkOnWhatsapp(creds, PERSON),
    invite: await fetchGroupInviteUrl(creds, GROUP),
    sent: await sendPlainText(creds, PERSON, INVITE_TEXT),
  };
}

/** What `fn` writes to the console, a line each, without printing any of it. */
async function consoleLinesOf(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const write = (...args: unknown[]) => void lines.push(args.map((a) => (typeof a === "string" ? a : inspect(a))).join(" "));
  const saved = { error: console.error, warn: console.warn, log: console.log, info: console.info, debug: console.debug };
  Object.assign(console, { error: write, warn: write, log: write, info: write, debug: write });
  try {
    await fn();
  } finally {
    Object.assign(console, saved);
  }
  return lines;
}

/** What Evolution answers an error with, repeating the number and the text of the call as it does for a message it refused. */
const errorNaming = (status: number) => ({
  status,
  json: { status, error: "Error", response: { message: [`Failed for ${PERSON}: ${INVITE_TEXT}`] } },
});

// ── The reads ────────────────────────────────────────────────────────────────

check("fetchAllGroups: GET /group/fetchAllGroups/{instance}?getParticipants=true, and the groups come parsed", async ({ startFake }) => {
  const fake = await startFake();
  assert.deepEqual(await fetchAllGroups(fake.creds), [OFERTAS]);
  assert.deepEqual(seen(fake), [
    { method: "GET", path: "/group/fetchAllGroups/e2e", query: { getParticipants: "true" }, body: undefined },
  ]);

  // { groups: [...] } is read as well; an empty list is a list.
  fake.set("fetchAllGroups", { status: 200, json: { groups: [FAKE_EVO_GROUP] } });
  assert.deepEqual(await fetchAllGroups(fake.creds), [OFERTAS]);
  fake.set("fetchAllGroups", { status: 200, json: [] });
  assert.deepEqual(await fetchAllGroups(fake.creds), []);
});

check("fetchAllGroups: an error, or an answer that is not a list of groups, is null and never an empty list", async ({ startFake }) => {
  const fake = await startFake();
  for (const [label, reply] of [
    ["500", { status: 500, json: { error: "boom" } }],
    ["404", { status: 404, json: { error: "Not Found" } }],
    ["500 that carries a list", { status: 500, json: [FAKE_EVO_GROUP] }],
    ["200 with an object that holds no list", { status: 200, json: {} }],
    ["200 with something that is not JSON", { status: 200 }],
    ["200 with null", { status: 200, json: null }],
    ["200 with a list of something else", { status: 200, json: { groups: "x" } }],
  ] as const) {
    fake.set("fetchAllGroups", reply);
    assert.equal(await fetchAllGroups(fake.creds), null, label);
  }
});

check("fetchGroupSummary: GET /group/findGroupInfos/{instance}?groupJid=…, in whichever envelope the group comes", async ({ startFake }) => {
  const fake = await startFake();
  assert.deepEqual(await fetchGroupSummary(fake.creds, GROUP), OFERTAS);
  assert.deepEqual(seen(fake), [
    { method: "GET", path: "/group/findGroupInfos/e2e", query: { groupJid: GROUP }, body: undefined },
  ]);

  // The shapes findGroupInfo already accepts: the group alone, in a list, or under `group` or `groupInfo`.
  for (const json of [FAKE_EVO_GROUP, [FAKE_EVO_GROUP], { group: FAKE_EVO_GROUP }, { groupInfo: FAKE_EVO_GROUP }]) {
    fake.set("findGroupInfos", { status: 200, json });
    assert.deepEqual(await fetchGroupSummary(fake.creds, GROUP), OFERTAS, JSON.stringify(Object.keys(json)));
  }
});

check("fetchGroupSummary: a group that isn't there, an error, or an answer with no group in it is null", async ({ startFake }) => {
  const fake = await startFake();
  // The fake's own answer for a group it doesn't know.
  assert.equal(await fetchGroupSummary(fake.creds, "120363999999999999@g.us"), null);
  for (const [label, reply] of [
    ["500", { status: 500, json: { error: "boom" } }],
    ["500 that carries the group", { status: 500, json: FAKE_EVO_GROUP }],
    ["200 with {}", { status: 200, json: {} }],
    ["200 with []", { status: 200, json: [] }],
    ["200 with a chat that is not a group", { status: 200, json: { id: "5511987654321@s.whatsapp.net", subject: "x" } }],
    ["200 with no JSON", { status: 200 }],
    ["200 with null", { status: 200, json: null }],
  ] as const) {
    fake.set("findGroupInfos", reply);
    assert.equal(await fetchGroupSummary(fake.creds, GROUP), null, label);
  }
});

check("fetchOwnerJid: GET /instance/fetchInstances?instanceName={instance}, in the v2 and the v1 answer", async ({ startFake }) => {
  const fake = await startFake();
  assert.equal(await fetchOwnerJid(fake.creds), FAKE_EVO_OWNER_JID);
  assert.deepEqual(seen(fake), [
    { method: "GET", path: "/instance/fetchInstances", query: { instanceName: "e2e" }, body: undefined },
  ]);

  fake.set("fetchInstances", { status: 200, json: [{ instance: { instanceName: "e2e", owner: FAKE_EVO_OWNER_JID } }] });
  assert.equal(await fetchOwnerJid(fake.creds), FAKE_EVO_OWNER_JID, "v1");
  // Several instances in the answer: the one in the credentials.
  fake.set("fetchInstances", {
    status: 200,
    json: [
      { name: "outra", ownerJid: "5511911112222@s.whatsapp.net" },
      { name: "e2e", ownerJid: FAKE_EVO_OWNER_JID },
    ],
  });
  assert.equal(await fetchOwnerJid(fake.creds), FAKE_EVO_OWNER_JID, "several");
});

check("fetchOwnerJid: another instance's number, an instance with no number, or an error is null", async ({ startFake }) => {
  const fake = await startFake();
  for (const [label, reply] of [
    ["only another instance", { status: 200, json: [{ name: "outra", ownerJid: "5511911112222@s.whatsapp.net" }] }],
    ["not linked yet", { status: 200, json: [{ name: "e2e", ownerJid: null }] }],
    ["an empty list", { status: 200, json: [] }],
    ["200 with null", { status: 200, json: null }],
    ["500", { status: 500, json: { error: "boom" } }],
    ["500 that carries the owner", { status: 500, json: [{ name: "e2e", ownerJid: FAKE_EVO_OWNER_JID }] }],
    ["404", { status: 404, json: { error: "Not Found" } }],
  ] as const) {
    fake.set("fetchInstances", reply);
    assert.equal(await fetchOwnerJid(fake.creds), null, label);
  }
});

check("the fake serves connectionState (open) as the client reads it, and a route can be swapped", async ({ startFake }) => {
  const fake = await startFake();
  assert.deepEqual(await connectionState(fake.creds), { ok: true, state: "open" });
  assert.deepEqual(seen(fake), [{ method: "GET", path: "/instance/connectionState/e2e", query: {}, body: undefined }]);
  fake.set("connectionState", { status: 200, json: { instance: { state: "close" } } });
  assert.deepEqual(await connectionState(fake.creds), { ok: true, state: "close" });
  fake.set("connectionState", { status: 500, json: {} });
  assert.deepEqual(await connectionState(fake.creds), { ok: false, state: "unknown", error: "Evolution 500" });
});

check("checkOnWhatsapp: POST /chat/whatsappNumbers/{instance} with { numbers: [number] }, true or false as it answers", async ({ startFake }) => {
  const fake = await startFake();
  assert.equal(await checkOnWhatsapp(fake.creds, PERSON), true);
  assert.deepEqual(seen(fake), [
    { method: "POST", path: "/chat/whatsappNumbers/e2e", query: {}, body: { numbers: [PERSON] } },
  ]);

  fake.set("whatsappNumbers", { status: 200, json: [{ exists: false, jid: `${PERSON}@s.whatsapp.net`, number: PERSON }] });
  assert.equal(await checkOnWhatsapp(fake.creds, PERSON), false);
  for (const [label, reply] of [
    ["200 with no answer for the number", { status: 200, json: [] }],
    ["200 with an object", { status: 200, json: {} }],
    ["200 with null", { status: 200, json: null }],
    ["500", { status: 500, json: { error: "boom" } }],
    ["500 that carries an answer", { status: 500, json: [{ exists: true, jid: `${PERSON}@s.whatsapp.net`, number: PERSON }] }],
  ] as const) {
    fake.set("whatsappNumbers", reply);
    assert.equal(await checkOnWhatsapp(fake.creds, PERSON), null, label);
  }
});

check("fetchGroupInviteUrl: GET /group/inviteCode/{instance}?groupJid=…, only a chat.whatsapp.com link comes back", async ({ startFake }) => {
  const fake = await startFake();
  assert.equal(await fetchGroupInviteUrl(fake.creds, GROUP), INVITE_LINK);
  assert.deepEqual(seen(fake), [
    { method: "GET", path: "/group/inviteCode/e2e", query: { groupJid: GROUP }, body: undefined },
  ]);

  fake.set("inviteCode", { status: 200, json: { inviteCode: "XyZ123" } });
  assert.equal(await fetchGroupInviteUrl(fake.creds, GROUP), "https://chat.whatsapp.com/XyZ123", "built from the code");
  for (const [label, reply] of [
    ["a link that is not WhatsApp's", { status: 200, json: { inviteUrl: "http://evil.example/x", inviteCode: "AbC" } }],
    ["no link and no code", { status: 200, json: {} }],
    ["200 with null", { status: 200, json: null }],
    ["404", { status: 404, json: { error: "No invite code" } }],
    ["500", { status: 500, json: { error: "boom" } }],
    ["500 that carries the link", { status: 500, json: { inviteUrl: INVITE_LINK, inviteCode: "AbC" } }],
  ] as const) {
    fake.set("inviteCode", reply);
    assert.equal(await fetchGroupInviteUrl(fake.creds, GROUP), null, label);
  }
});

// ── The two writes ───────────────────────────────────────────────────────────

check("addGroupParticipant: POST /group/updateParticipant/{instance}?groupJid=… with action add and one number, and its code comes back", async ({ startFake }) => {
  const fake = await startFake();
  assert.deepEqual(await addGroupParticipant(fake.creds, GROUP, PERSON), { httpStatus: 201, code: "200" });
  assert.deepEqual(seen(fake), [
    {
      method: "POST",
      path: "/group/updateParticipant/e2e",
      query: { groupJid: GROUP },
      body: { action: "add", participants: [PERSON] },
    },
  ]);
});

check("addGroupParticipant: the code of the number is read whatever its type, and anything else is no code", async ({ startFake }) => {
  const fake = await startFake();
  const update = (status: unknown) => ({
    status: 201,
    json: { updateParticipants: [{ status, jid: `${PERSON}@s.whatsapp.net`, content: null }] },
  });
  for (const [label, reply, expected] of [
    // The refusal for the person's privacy settings carries the link request along.
    [
      "privacy",
      {
        status: 201,
        json: {
          updateParticipants: [
            {
              status: "403",
              jid: `${PERSON}@s.whatsapp.net`,
              content: { tag: "add_request", attrs: { code: "XyZ", expiration: "1700000000" } },
            },
          ],
        },
      },
      { httpStatus: 201, code: "403" },
    ],
    ["already in", update("409"), { httpStatus: 201, code: "409" }],
    ["a numeric status", update(200), { httpStatus: 201, code: "200" }],
    ["any other code", update("408"), { httpStatus: 201, code: "408" }],
    ["201 with no updateParticipants", { status: 201, json: {} }, { httpStatus: 201, code: null }],
    ["201 with an empty list", { status: 201, json: { updateParticipants: [] } }, { httpStatus: 201, code: null }],
    ["201 with no JSON", { status: 201 }, { httpStatus: 201, code: null }],
    ["201 with null", { status: 201, json: null }, { httpStatus: 201, code: null }],
    ["a refusal of the request", { status: 400, json: { status: 400, error: "Bad Request" } }, { httpStatus: 400, code: null }],
    ["500", { status: 500, json: { error: "boom" } }, { httpStatus: 500, code: null }],
    ["502 from a proxy, with no JSON", { status: 502 }, { httpStatus: 502, code: null }],
  ] as const) {
    fake.set("updateParticipant", reply);
    assert.deepEqual(await addGroupParticipant(fake.creds, GROUP, PERSON), expected, label);
  }
});

check("sendPlainText: POST /message/sendText/{instance} with the number and the text exactly as given", async ({ startFake }) => {
  const fake = await startFake();
  assert.deepEqual(await sendPlainText(fake.creds, PERSON, INVITE_TEXT), { ok: true, httpStatus: 201 });
  assert.deepEqual(seen(fake), [
    { method: "POST", path: "/message/sendText/e2e", query: {}, body: { number: PERSON, text: INVITE_TEXT } },
  ]);

  // Nothing is trimmed or rewritten on the way: the text is what the person typed, down to the spaces at its ends.
  const padded = "  Oi, tudo bem?\r\n\n";
  assert.deepEqual(await sendPlainText(fake.creds, PERSON, padded), { ok: true, httpStatus: 201 });
  assert.deepEqual(fake.calls[1]?.body, { number: PERSON, text: padded });

  // A success whose body is a bare null is still a success: the status is the answer, and nothing reads the body.
  fake.set("sendText", { status: 201, json: null });
  assert.deepEqual(await sendPlainText(fake.creds, PERSON, INVITE_TEXT), { ok: true, httpStatus: 201 });

  fake.set("sendText", { status: 400, json: { status: 400, error: "Bad Request" } });
  assert.deepEqual(await sendPlainText(fake.creds, PERSON, INVITE_TEXT), { ok: false, httpStatus: 400 });
  fake.set("sendText", { status: 500, json: { error: "boom" } });
  assert.deepEqual(await sendPlainText(fake.creds, PERSON, INVITE_TEXT), { ok: false, httpStatus: 500 });
});

check("only the two permitted writes reach Evolution: an add with action add, and the invite text", async ({ startFake }) => {
  const fake = await startFake();
  await tour(fake.creds);
  await addGroupParticipant(fake.creds, GROUP, "5511912345678");

  // Every call landed on a route the fake serves: nothing went to /group/sendInvite, or to any path of the group's settings.
  assert.deepEqual(
    fake.calls.filter((c) => c.route === null),
    [],
  );
  // Of the calls that can change something, the add and the text are the only ones; whatsappNumbers only asks.
  const writes = fake.calls.filter((c) => c.method !== "GET" && c.route !== "whatsappNumbers");
  assert.deepEqual(
    writes.map((c) => c.route),
    ["updateParticipant", "sendText", "updateParticipant"],
  );
  for (const call of writes.filter((c) => c.route === "updateParticipant")) {
    assert.equal((call.body as { action?: unknown }).action, "add");
  }
});

// ── How the calls are made ───────────────────────────────────────────────────

check("every call sends the apikey of the credentials", async ({ startFake }) => {
  const fake = await startFake();
  await tour(fake.creds);
  assert.equal(fake.calls.length, 7);
  assert.deepEqual(
    fake.calls.map((c) => c.apikey),
    Array(7).fill("e2e"),
  );
});

check("the instance name is encoded in the path (and in the query of fetchInstances), whatever it holds", async ({ startFake }) => {
  const instance = "METODO AI #1/b&c";
  const fake = await startFake(instance);
  const result = await tour(fake.creds);
  const encoded = encodeURIComponent(instance);
  // A call whose instance wasn't encoded would break the path in two and match no route.
  assert.deepEqual(
    fake.calls.map((c) => [c.route, c.instance]),
    [
      ["fetchAllGroups", instance],
      ["findGroupInfos", instance],
      ["fetchInstances", instance],
      ["updateParticipant", instance],
      ["whatsappNumbers", instance],
      ["inviteCode", instance],
      ["sendText", instance],
    ],
  );
  assert.deepEqual(
    fake.calls.filter((c) => c.route !== "fetchInstances").map((c) => c.path.split("/").pop()),
    Array(6).fill(encoded),
  );
  assert.deepEqual(fake.calls[2]?.query, { instanceName: instance });
  assert.equal(result.owner, FAKE_EVO_OWNER_JID);
});

check("each call asks for its own timeout", async ({ startFake }) => {
  const fake = await startFake();
  const asked: number[] = [];
  const original = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => {
    asked.push(ms);
    return original.call(AbortSignal, ms);
  };
  try {
    await tour(fake.creds);
  } finally {
    AbortSignal.timeout = original;
  }
  // fetchAllGroups, fetchGroupSummary, fetchOwnerJid, addGroupParticipant, checkOnWhatsapp, fetchGroupInviteUrl, sendPlainText
  assert.deepEqual(asked, [30_000, 20_000, 15_000, 30_000, 15_000, 15_000, 30_000]);
});

// ── When Evolution fails ─────────────────────────────────────────────────────

check("a connection the server closes without an answer: httpStatus 0 and no code for the add, ok false for the text, null for the reads", async ({ startFake }) => {
  const fake = await startFake();
  for (const route of FAKE_EVO_ROUTES) fake.set(route, "drop");
  assert.deepEqual(await addGroupParticipant(fake.creds, GROUP, PERSON), { httpStatus: 0, code: null });
  assert.deepEqual(await sendPlainText(fake.creds, PERSON, INVITE_TEXT), { ok: false, httpStatus: 0 });
  assert.equal(await fetchAllGroups(fake.creds), null);
  assert.equal(await fetchGroupSummary(fake.creds, GROUP), null);
  assert.equal(await fetchOwnerJid(fake.creds), null);
  assert.equal(await checkOnWhatsapp(fake.creds, PERSON), null);
  assert.equal(await fetchGroupInviteUrl(fake.creds, GROUP), null);
  // Each call reached the server once (none was asked again behind the caller's back): it is the dropped connection, not
  // a wrong address, that gave these answers.
  assert.equal(fake.calls.length, 7);
});

check("a server that isn't there gives the same answers", async ({ startFake }) => {
  const fake = await startFake();
  await fake.close();
  assert.deepEqual(await addGroupParticipant(fake.creds, GROUP, PERSON), { httpStatus: 0, code: null });
  assert.deepEqual(await sendPlainText(fake.creds, PERSON, INVITE_TEXT), { ok: false, httpStatus: 0 });
  assert.equal(await fetchAllGroups(fake.creds), null);
  assert.equal(await fetchOwnerJid(fake.creds), null);
  assert.equal(fake.calls.length, 0);
});

check("a 2xx whose JSON body is null throws in none of the seven calls: the reads are null, the add has no code, the text went", async ({ startFake }) => {
  const fake = await startFake();
  // `req()` hands a bare null over as the body (its catch only covers a body that doesn't parse), so a call that reads
  // `.groups` or `.group` off it would throw a TypeError at its caller instead of answering null.
  for (const route of FAKE_EVO_ROUTES) fake.set(route, { status: 200, json: null });
  assert.deepEqual(await tour(fake.creds), {
    groups: null,
    summary: null,
    owner: null,
    add: { httpStatus: 200, code: null },
    exists: null,
    invite: null,
    sent: { ok: true, httpStatus: 200 },
  });
  assert.equal(fake.calls.length, 7);
});

check("a call that fails writes nothing to the console that holds the number or the text, even when Evolution's own error does", async ({ startFake }) => {
  const fake = await startFake();
  // The control: the capture does see a line, so an empty capture below means something.
  assert.deepEqual(
    await consoleLinesOf(async () => console.error("probe")),
    ["probe"],
  );

  // 500 on sendText, as asked; and the same on every other route, which is the stronger claim.
  fake.set("sendText", errorNaming(500));
  const sendLines = await consoleLinesOf(async () => {
    assert.deepEqual(await sendPlainText(fake.creds, PERSON, INVITE_TEXT), { ok: false, httpStatus: 500 });
  });
  for (const route of FAKE_EVO_ROUTES) fake.set(route, errorNaming(500));
  const tourLines = await consoleLinesOf(async () => {
    const result = await tour(fake.creds);
    assert.deepEqual(result.add, { httpStatus: 500, code: null });
    assert.deepEqual(result.sent, { ok: false, httpStatus: 500 });
    assert.equal(result.owner, null);
  });

  for (const line of [...sendLines, ...tourLines]) {
    // The message says nothing of the line: a failing assertion must not print the number or the text either.
    for (const secret of [PERSON, INVITE_TEXT, "Oi Ana", "chat.whatsapp.com"]) {
      assert.ok(!line.includes(secret), "a console line holds the number or the text");
    }
  }
});

// ── The fake itself ──────────────────────────────────────────────────────────

check("the fake records every call with its query and body parsed, runs a swapped handler with the call, and answers 404 to the rest", async ({ startFake }) => {
  const fake = await startFake();
  const ask = (path: string, init: RequestInit = {}) =>
    fetch(`${fake.creds.baseUrl}${path}`, { headers: { apikey: "k", "Content-Type": "application/json" }, ...init });

  fake.set("inviteCode", (call) => ({ status: 200, json: { echoed: call.query.groupJid, instance: call.instance } }));
  const echoed = await ask(`/group/inviteCode/inst%201?groupJid=${encodeURIComponent("abc@g.us")}&x=1`);
  assert.deepEqual(await echoed.json(), { echoed: "abc@g.us", instance: "inst 1" });

  const missing = await ask("/group/sendInvite/e2e", { method: "POST", body: JSON.stringify({ groupJid: GROUP }) });
  assert.equal(missing.status, 404);
  // A route is only served with its own method.
  assert.equal((await ask("/group/updateParticipant/e2e")).status, 404);
  assert.equal((await ask("/group/updateParticipant/e2e", { method: "POST", body: "not json" })).status, 201);

  assert.deepEqual(fake.calls, [
    {
      route: "inviteCode",
      method: "GET",
      path: "/group/inviteCode/inst%201",
      instance: "inst 1",
      query: { groupJid: "abc@g.us", x: "1" },
      body: undefined,
      apikey: "k",
    },
    {
      route: null,
      method: "POST",
      path: "/group/sendInvite/e2e",
      instance: null,
      query: {},
      body: { groupJid: GROUP },
      apikey: "k",
    },
    { route: null, method: "GET", path: "/group/updateParticipant/e2e", instance: null, query: {}, body: undefined, apikey: "k" },
    {
      route: "updateParticipant",
      method: "POST",
      path: "/group/updateParticipant/e2e",
      instance: "e2e",
      query: {},
      body: "not json",
      apikey: "k",
    },
  ]);
});

// ── The database: organizations, a clock and a scheduler of our own ──────────

type World = {
  prisma: PrismaClient;
  /** The number every instance of the fakes is linked to. New on each run of this script, so nothing an earlier run left behind shares its day. */
  owner: string;
  orgA: string;
  orgB: string;
  /** Owns `connA`. */
  userA: string;
  /** A member of org A with no number of their own. */
  colleague: string;
  /** Owns `connB`. */
  userB: string;
  connA: string;
  connB: string;
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** The hosts the script refused to call. A check ends with none. */
const refused: string[] = [];

function assertLoopback(baseUrl: string): void {
  // The message says nothing of the URL: it may carry a key.
  assert.ok(LOOPBACK.has(new URL(baseUrl).hostname), "a connection of the check does not point at loopback");
}

/** Fails every fetch to a host that isn't loopback and writes the host down (.env points EVOLUTION_API_URL at the real server). Returns the undo. */
function refuseOtherHosts(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(href).hostname;
    if (!LOOPBACK.has(host)) {
      refused.push(host);
      throw new Error("blocked: not a loopback host");
    }
    return real(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

/** 10:00 in São Paulo: inside the window; the São Paulo day starts at 03:00Z. */
const START_AT = "2026-10-28T13:00:00.000Z";
const at = (iso: string) => new Date(iso);

/** The runner's clock: only a check or a sleep moves it. */
const clock = { at: at(START_AT), sleeps: [] as number[] };

/** What the runner asked to run in the background (instead of after() or the queue). */
const scheduled: (() => Promise<void>)[] = [];

/** Runs the scheduled tasks, one after the other, until none is left; the number that ran. */
async function drain(): Promise<number> {
  let ran = 0;
  for (let task = scheduled.shift(); task; task = scheduled.shift()) {
    await task();
    ran++;
  }
  return ran;
}

function installRuntime(): void {
  groupAddRuntime.now = () => new Date(clock.at);
  groupAddRuntime.sleep = async (ms) => {
    clock.sleeps.push(ms);
    clock.at = new Date(clock.at.getTime() + ms);
  };
  groupAddRuntime.random = () => 0;
  groupAddRuntime.schedule = (task) => {
    scheduled.push(task);
  };
}

async function until(done: () => boolean, what: string): Promise<void> {
  const end = Date.now() + 5_000;
  while (!done()) {
    assert.ok(Date.now() < end, `timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const OTHER_GROUP = "120363000000000002@g.us";
const TEMPLATE = "Oi {{nome}}! Este é o link para entrar no grupo {{grupo}}:";
/** The n-th test number as the CRM has it: a BR mobile with the country code. */
const N = (n: number) => `551191111${String(n).padStart(4, "0")}`;
const FRIEND_NUMBER = "5511912345678";

type Member = Record<string, unknown>;
const meIn = (w: World, admin: "superadmin" | "admin" | null): Member => ({ id: `${w.owner}@s.whatsapp.net`, admin });
/** A member whose LID comes with the number, and one whose LID doesn't. */
const FRIEND: Member = { id: "1@lid", phoneNumber: `${FRIEND_NUMBER}@s.whatsapp.net`, admin: null };
const NAMELESS: Member = { id: "2@lid", admin: null };
const groupJson = (jid: string, subject: string, members: Member[], extra: Record<string, unknown> = {}) => ({
  ...FAKE_EVO_GROUP,
  id: jid,
  subject,
  size: members.length,
  participants: members,
  ...extra,
});

/** The groups a fake serves, by JID. A check changes them to change what Evolution answers. */
type Groups = Record<string, unknown>;

/** Links the fake's instances to the number of this run and serves `groups`. */
function wire(w: World, fake: FakeEvolution, groups: Groups): void {
  fake.set("fetchInstances", (call) => ({ status: 200, json: [{ name: call.instance ?? "", ownerJid: `${w.owner}@s.whatsapp.net` }] }));
  fake.set("findGroupInfos", (call) => {
    const group = groups[call.query.groupJid ?? ""];
    return group
      ? { status: 200, json: group }
      : { status: 404, json: { status: 404, error: "Not Found", response: { message: ["Group not found"] } } };
  });
  fake.set("fetchAllGroups", () => ({ status: 200, json: Object.values(groups) }));
}

/** Points the two connections at this check's fake. */
async function aim(w: World, fake: StartedFake): Promise<void> {
  assertLoopback(fake.creds.baseUrl);
  for (const [id, instance] of [
    [w.connA, "wga-a"],
    [w.connB, "wga-b"],
  ] as const) {
    await w.prisma.integrationConnection.update({
      where: { id },
      data: { credentialsEnc: encryptCredentials({ baseUrl: fake.creds.baseUrl, apiKey: "e2e", instance }), status: "ACTIVE" },
    });
  }
}

/**
 * Reads back every connection of the two organizations and checks each one carries a base URL of its own on loopback, a key and an
 * instance, before any call goes out. A connection without a base URL would fall back to the Evolution of .env, which is real.
 */
async function assertConnectionsLoopback(w: World): Promise<void> {
  const rows = await w.prisma.integrationConnection.findMany({
    where: { organizationId: { in: [w.orgA, w.orgB] } },
    select: { credentialsEnc: true },
  });
  assert.ok(rows.length >= 2, "the throwaway connections are missing");
  for (const row of rows) {
    const creds = decryptCredentials(row.credentialsEnc);
    assert.ok(creds.baseUrl && creds.apiKey && creds.instance, "a connection of the check has no base URL, key or instance of its own");
    assertLoopback(creds.baseUrl);
  }
}

/** Removes what the checks before left in the two organizations. */
async function wipe(w: World): Promise<void> {
  const inTest = { organizationId: { in: [w.orgA, w.orgB] } };
  await w.prisma.whatsappGroupAddRun.deleteMany({ where: inTest }); // the items go with it
  await w.prisma.contact.deleteMany({ where: inTest });
  await w.prisma.contactFolder.deleteMany({ where: inTest });
  // A check that adds a connection of its own leaves it only until here.
  await w.prisma.integrationConnection.deleteMany({ where: { ...inTest, id: { notIn: [w.connA, w.connB] } } });
}

/** A clean slate: no data of an earlier check, the clock at 10:00, nothing scheduled, a fake linked to the number of this run. */
async function scenario(ctx: Ctx) {
  const w = ctx.world;
  await wipe(w);
  clock.at = at(START_AT);
  clock.sleeps = [];
  scheduled.length = 0;
  installRuntime();
  const fake = await ctx.startFake();
  const groups: Groups = {
    [GROUP]: groupJson(GROUP, "Ofertas", [meIn(w, "superadmin"), FRIEND, NAMELESS]),
    [OTHER_GROUP]: groupJson(OTHER_GROUP, "Avisos", [meIn(w, "superadmin")]),
  };
  wire(w, fake, groups);
  await aim(w, fake);
  await assertConnectionsLoopback(w);
  return { fake, groups, w };
}

let contactSeq = 0;

/** A contact; creation times strictly increase, so the order in a folder is the order of the calls. */
async function contactOf(
  w: World,
  o: { name: string; phone: string | null; org?: string; optedOut?: boolean; folderId?: string | null },
): Promise<string> {
  const contact = await w.prisma.contact.create({
    data: {
      organizationId: o.org ?? w.orgA,
      name: o.name,
      phone: o.phone,
      optedOut: o.optedOut ?? false,
      folderId: o.folderId ?? null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, contactSeq++)),
    },
    select: { id: true },
  });
  return contact.id;
}

/** `count` contacts named "Pessoa n" with the numbers N(n), from `from`; their ids. */
async function people(w: World, count: number, o: { org?: string; from?: number; folderId?: string | null } = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let n = o.from ?? 1; n < (o.from ?? 1) + count; n++) {
    ids.push(await contactOf(w, { name: `Pessoa ${n}`, phone: N(n), org: o.org, folderId: o.folderId }));
  }
  return ids;
}

async function folderOf(w: World, name: string, org = w.orgA): Promise<string> {
  const folder = await w.prisma.contactFolder.create({ data: { organizationId: org, name }, select: { id: true } });
  return folder.id;
}

const ofContacts = (contactIds: string[]): GroupAddSource => ({ kind: "contacts", contactIds });

/** Starts a run and checks it was accepted; its id. */
async function begin(
  w: World,
  o: { source: GroupAddSource; group?: string; text?: string; org?: string; user?: string },
): Promise<string> {
  const res = await startGroupAdd(o.org ?? w.orgA, o.user ?? w.userA, {
    source: o.source,
    groupJid: o.group ?? GROUP,
    inviteText: o.text ?? TEMPLATE,
  });
  assert.ok(res.ok, JSON.stringify(res));
  return res.runId;
}

type SeedItem = {
  name: string;
  phone: string | null;
  status: GroupAddItemStatus;
  reason?: string | null;
  processedAt?: Date | null;
};

/** A run written straight to the table, with its items in order. */
async function seedRun(
  w: World,
  o: {
    org?: string;
    group?: string;
    senderKey?: string;
    connectionId?: string;
    status?: "QUEUED" | "RUNNING" | "PAUSED" | "DONE" | "CANCELED";
    pausedReason?: string | null;
    lastError?: string | null;
    nextAttemptAt?: Date | null;
    lastDispatchAt?: Date | null;
    inviteUrl?: string | null;
    createdAt?: Date;
    items?: SeedItem[];
  } = {},
): Promise<string> {
  const org = o.org ?? w.orgA;
  const senderKey = o.senderKey ?? w.owner;
  const run = await w.prisma.whatsappGroupAddRun.create({
    data: {
      organizationId: org,
      connectionId: o.connectionId ?? (org === w.orgA ? w.connA : w.connB),
      senderKey,
      createdById: org === w.orgA ? w.userA : w.userB,
      groupJid: o.group ?? GROUP,
      groupName: "Ofertas",
      inviteText: TEMPLATE,
      inviteUrl: o.inviteUrl ?? null,
      status: o.status ?? "DONE",
      pausedReason: o.pausedReason ?? null,
      lastError: o.lastError ?? null,
      nextAttemptAt: o.nextAttemptAt ?? null,
      lastDispatchAt: o.lastDispatchAt ?? null,
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    },
    select: { id: true },
  });
  await w.prisma.whatsappGroupAddItem.createMany({
    data: (o.items ?? []).map((item, position) => ({
      organizationId: org,
      runId: run.id,
      contactId: `seed-${run.id}-${position}`,
      contactName: item.name,
      position,
      phone: item.phone,
      phoneKey: item.phone ? phoneMatchKey(item.phone) : null,
      senderKey,
      status: item.status,
      reason: item.reason ?? null,
      processedAt: item.processedAt ?? null,
    })),
  });
  return run.id;
}

const runOf = (w: World, id: string) => w.prisma.whatsappGroupAddRun.findFirstOrThrow({ where: { id } });
const itemsOf = (w: World, runId: string) => w.prisma.whatsappGroupAddItem.findMany({ where: { runId }, orderBy: { position: "asc" } });
/** [name, status, reason] of each item, in the order of the run. */
const verdicts = async (w: World, runId: string) => (await itemsOf(w, runId)).map((i) => [i.contactName, i.status, i.reason] as const);

const bodyOf = (call: FakeEvoCall): Record<string, unknown> =>
  typeof call.body === "object" && call.body !== null ? (call.body as Record<string, unknown>) : {};
/** The one number an add, a number check or a text carries. */
const numberOf = (call: FakeEvoCall): string => {
  const body = bodyOf(call);
  const list = body.participants ?? body.numbers ?? [body.number];
  return Array.isArray(list) ? String(list[0] ?? "") : "";
};
const callsTo = (fake: FakeEvolution, ...routes: string[]) => fake.calls.filter((c) => c.route !== null && routes.includes(c.route));
const addedNumbers = (fake: FakeEvolution) => callsTo(fake, "updateParticipant").map(numberOf);
const texts = (fake: FakeEvolution) => callsTo(fake, "sendText").map(bodyOf);

const addReply = (number: string, status: string, content: unknown = null): FakeEvoReply => ({
  status: 201,
  json: { updateParticipants: [{ status, jid: `${number}@s.whatsapp.net`, content }] },
});
/** What WhatsApp gives for a person whose privacy settings ask for the link instead. */
const PRIVACY = { tag: "add_request", attrs: { code: "XyZ", expiration: "1700000000" } };
const notOnWhatsapp = (number: string): FakeEvoReply => ({
  status: 200,
  json: [{ exists: false, jid: `${number}@s.whatsapp.net`, number }],
});

/** The cron's list, limited to the throwaway organizations (the database may hold runs of someone's manual tests). */
const dueIn = (w: World, now = groupAddRuntime.now()) =>
  findDueGroupAddRuns(now, { organizationId: { in: [w.orgA, w.orgB] } });

// ── The read of the groups and the preview ───────────────────────────────────

check("listMyGroups: the groups of the caller's own number, admin true / false / null as the number is, in or can't be told", async (ctx) => {
  const { fake, groups, w } = await scenario(ctx);
  const CLIENTES = "120363000000000011@g.us";
  const MISTERIO = "120363000000000012@g.us";
  groups[CLIENTES] = groupJson(CLIENTES, "Clientes", [meIn(w, null), FRIEND], { announce: false });
  // The number isn't among the members that have one, and one member has none: it could be that one.
  groups[MISTERIO] = groupJson(MISTERIO, "Mistério", [FRIEND, NAMELESS], { announce: undefined });

  assert.deepEqual(await listMyGroups(w.orgA, w.userA), {
    ok: true,
    groups: [
      { jid: OTHER_GROUP, subject: "Avisos", size: 1, announce: true, admin: true },
      { jid: CLIENTES, subject: "Clientes", size: 2, announce: false, admin: false },
      { jid: MISTERIO, subject: "Mistério", size: 2, announce: null, admin: null },
      { jid: GROUP, subject: "Ofertas", size: 3, announce: true, admin: true },
    ],
  });
  // The caller's own instance, asked in this order, and nothing written.
  assert.deepEqual(
    fake.calls.map((c) => [c.route, c.instance]),
    [
      ["connectionState", "wga-a"],
      ["fetchInstances", "wga-a"],
      ["fetchAllGroups", "wga-a"],
    ],
  );
});

check("listMyGroups: Evolution out of reach is unavailable, a number that isn't open is disconnected", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  fake.set("fetchAllGroups", { status: 500, json: { error: "boom" } });
  assert.deepEqual(await listMyGroups(w.orgA, w.userA), { ok: false, error: "unavailable" });
  fake.set("fetchAllGroups", "drop");
  assert.deepEqual(await listMyGroups(w.orgA, w.userA), { ok: false, error: "unavailable" });

  fake.set("connectionState", { status: 500, json: {} });
  assert.deepEqual(await listMyGroups(w.orgA, w.userA), { ok: false, error: "unavailable" });
  for (const state of ["close", "connecting"]) {
    fake.set("connectionState", { status: 200, json: { instance: { state } } });
    assert.deepEqual(await listMyGroups(w.orgA, w.userA), { ok: false, error: "disconnected" }, state);
  }
});

check("a number with no ownerJid lists every group with admin null, and no round starts from it", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  fake.set("fetchInstances", { status: 200, json: [{ name: "wga-a", ownerJid: null }] });
  const listed = await listMyGroups(w.orgA, w.userA);
  assert.ok(listed.ok);
  assert.deepEqual(
    listed.groups.map((g) => [g.subject, g.admin]),
    [
      ["Avisos", null],
      ["Ofertas", null],
    ],
  );
  const [pessoa] = await people(w, 1);
  assert.deepEqual(
    await startGroupAdd(w.orgA, w.userA, { source: ofContacts([pessoa]), groupJid: GROUP, inviteText: TEMPLATE }),
    { ok: false, error: "not_admin" },
  );
  assert.deepEqual(await previewGroupAdd(w.orgA, w.userA, ofContacts([pessoa]), GROUP), { ok: false, error: "not_admin" });
  assert.equal(await w.prisma.whatsappGroupAddRun.count({ where: { organizationId: w.orgA } }), 0);
});

check("a user with no number of their own gets no_connection, even when a colleague of the org has an active one", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const [pessoa] = await people(w, 1);
  const noConnection = { ok: false, error: "no_connection" };
  assert.deepEqual(await listMyGroups(w.orgA, w.colleague), noConnection);
  assert.deepEqual(await previewGroupAdd(w.orgA, w.colleague, ofContacts([pessoa]), GROUP), noConnection);
  assert.deepEqual(
    await startGroupAdd(w.orgA, w.colleague, { source: ofContacts([pessoa]), groupJid: GROUP, inviteText: TEMPLATE }),
    noConnection,
  );
  // Another org's number is no one's here either.
  assert.deepEqual(await listMyGroups(w.orgA, w.userB), noConnection);
  assert.equal(fake.calls.length, 0, "the colleague's number was used");
  assert.equal(await w.prisma.whatsappGroupAddRun.count({ where: { organizationId: w.orgA } }), 0);
  // The owner of the number still has it.
  assert.ok((await listMyGroups(w.orgA, w.userA)).ok);

  // A connection that isn't active is not a number to use.
  await w.prisma.integrationConnection.update({ where: { id: w.connA }, data: { status: "INACTIVE" } });
  assert.deepEqual(await listMyGroups(w.orgA, w.userA), noConnection);
  await w.prisma.integrationConnection.update({ where: { id: w.connA }, data: { status: "ACTIVE" } });

  // With two, the newest.
  fake.calls.length = 0;
  await w.prisma.integrationConnection.create({
    data: {
      organizationId: w.orgA,
      ownerId: w.userA,
      provider: "EVOLUTION",
      label: "wga newer",
      status: "ACTIVE",
      credentialsEnc: encryptCredentials({ baseUrl: fake.creds.baseUrl, apiKey: "e2e", instance: "wga-a2" }),
    },
  });
  await assertConnectionsLoopback(w);
  assert.ok((await listMyGroups(w.orgA, w.userA)).ok);
  assert.ok(fake.calls.length > 0 && fake.calls.every((c) => c.instance === "wga-a2"), "not the newest connection");
});

check("previewGroupAdd: the exact counts of a folder with a contact of each kind, a previous round included, and nothing is written", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const folderId = await folderOf(w, "Clientes VIP");
  const pendente = await contactOf(w, { name: "Pendente", phone: N(1), folderId });
  await contactOf(w, { name: "Já estava", phone: "(11) 91234-5678", folderId }); // the member of the group, typed with a mask
  await contactOf(w, { name: "Fixo", phone: "(11) 3333-4444", folderId });
  await contactOf(w, { name: "Sem telefone", phone: null, folderId });
  await contactOf(w, { name: "Optout", phone: N(9), optedOut: true, folderId });
  const saiu = await contactOf(w, { name: "Saiu", phone: "(11) 91111-0006", folderId }); // added by an earlier round, not in the group now
  await contactOf(w, { name: "Convidado", phone: "11 91111-0007", folderId }); // got the link in an earlier round
  await contactOf(w, { name: "Repetido", phone: "(11) 91111-0001", folderId }); // the number of Pendente again
  await contactOf(w, { name: "Outra pasta", phone: N(8) });

  const longAgo = at("2026-10-20T12:00:00.000Z");
  await seedRun(w, {
    items: [
      { name: "Saiu", phone: N(6), status: "ADDED", processedAt: longAgo },
      { name: "Convidado", phone: N(7), status: "INVITED", processedAt: longAgo },
      { name: "Pendente", phone: N(1), status: "FAILED", reason: "http_500", processedAt: longAgo }, // not a reason to leave anyone out
    ],
  });
  // Rounds that are not about this org and this group say nothing about it.
  await seedRun(w, { group: OTHER_GROUP, items: [{ name: "Pendente", phone: N(1), status: "ADDED", processedAt: longAgo }] });
  await seedRun(w, { org: w.orgB, items: [{ name: "Pendente", phone: N(1), status: "ADDED", processedAt: longAgo }] });
  // Two people tried today on this number (by a round of another org): they count for the day.
  await seedRun(w, {
    org: w.orgB,
    group: OTHER_GROUP,
    items: [
      { name: "x", phone: null, status: "ADDED", processedAt: at("2026-10-28T12:00:00.000Z") },
      { name: "y", phone: null, status: "INVITED", processedAt: at("2026-10-28T12:01:00.000Z") },
    ],
  });
  const runsBefore = await w.prisma.whatsappGroupAddRun.count({ where: { organizationId: w.orgA } });
  const itemsBefore = await w.prisma.whatsappGroupAddItem.count({ where: { organizationId: w.orgA } });

  const preview = await previewGroupAdd(w.orgA, w.userA, { kind: "folder", folderId }, GROUP);
  assert.deepEqual(preview, {
    ok: true,
    group: { jid: GROUP, subject: "Ofertas", size: 3, announce: true, admin: true },
    counts: { total: 8, pending: 1, alreadyIn: 1, noWhatsapp: 1, skipped: 3, leftGroup: 1, alreadyInvited: 1 },
    usedToday: 2,
    forecastAt: "2026-10-28T13:01:00.000Z",
    overLimit: false,
  });

  // The same plan from a selection of contacts.
  const picked = await previewGroupAdd(w.orgA, w.userA, ofContacts([pendente, saiu]), GROUP);
  assert.ok(picked.ok);
  assert.deepEqual(picked.counts, { total: 2, pending: 1, alreadyIn: 0, noWhatsapp: 0, skipped: 0, leftGroup: 1, alreadyInvited: 0 });
  // Contacts with no folder are a source of their own.
  const loose = await previewGroupAdd(w.orgA, w.userA, { kind: "folder", folderId: null }, GROUP);
  assert.ok(loose.ok);
  assert.deepEqual(loose.counts, { total: 1, pending: 1, alreadyIn: 0, noWhatsapp: 0, skipped: 0, leftGroup: 0, alreadyInvited: 0 });

  // What can't be planned.
  assert.deepEqual(await previewGroupAdd(w.orgA, w.userA, { kind: "folder", folderId: "nope" }, GROUP), { ok: false, error: "not_found" });
  assert.deepEqual(await previewGroupAdd(w.orgA, w.userA, { kind: "folder", folderId: await folderOf(w, "Vazia") }, GROUP), { ok: false, error: "empty" });
  assert.deepEqual(await previewGroupAdd(w.orgA, w.userA, ofContacts([]), GROUP), { ok: false, error: "empty" });
  const ofB = await contactOf(w, { name: "Da outra empresa", phone: N(2), org: w.orgB });
  assert.deepEqual(await previewGroupAdd(w.orgA, w.userA, ofContacts([ofB]), GROUP), { ok: false, error: "empty" });
  assert.deepEqual(await previewGroupAdd(w.orgA, w.userA, { kind: "folder", folderId }, "120363999999999999@g.us"), { ok: false, error: "not_found" });

  // Nothing was written, to the table or to WhatsApp.
  assert.equal(await w.prisma.whatsappGroupAddRun.count({ where: { organizationId: w.orgA } }), runsBefore);
  assert.equal(await w.prisma.whatsappGroupAddItem.count({ where: { organizationId: w.orgA } }), itemsBefore);
  assert.deepEqual(callsTo(fake, "updateParticipant", "sendText", "whatsappNumbers"), []);
});

check("previewGroupAdd: a group that the number does not run is not_admin, and one that would pass 1,024 people is over the limit", async (ctx) => {
  const { groups, w } = await scenario(ctx);
  const [one, two, three, four, five, six] = await people(w, 6);
  groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, null), FRIEND]);
  assert.deepEqual(await previewGroupAdd(w.orgA, w.userA, ofContacts([one]), GROUP), { ok: false, error: "not_admin" });

  // Room for 3 more people: 6 are pending, so the last 3 would not fit.
  groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, "admin"), FRIEND], { size: 1021 });
  const preview = await previewGroupAdd(w.orgA, w.userA, ofContacts([one, two, three, four, five, six]), GROUP);
  assert.ok(preview.ok);
  assert.equal(preview.overLimit, true);
  assert.equal(preview.group.size, 1021);
  assert.equal(preview.counts.pending, 6);
  // The forecast is for the 3 that fit.
  assert.equal(preview.forecastAt, "2026-10-28T13:03:00.000Z");
});

// ── The run ──────────────────────────────────────────────────────────────────

check("a full run: added, invited by text, already in, failed, no WhatsApp; the opted-out contact is never asked about", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const folderId = await folderOf(w, "Clientes");
  await contactOf(w, { name: "Ana", phone: N(1), folderId }); // added
  await contactOf(w, { name: "Bia", phone: N(2), folderId }); // her privacy settings ask for the link
  await contactOf(w, { name: "Caio", phone: N(3), folderId }); // already a member
  await contactOf(w, { name: "Davi", phone: N(4), folderId }); // HTTP 500
  await contactOf(w, { name: "Eva", phone: N(5), folderId }); // no WhatsApp account
  await contactOf(w, { name: "Fábio", phone: N(6), optedOut: true, folderId });
  fake.set("updateParticipant", (call) => {
    const number = numberOf(call);
    if (number === N(2)) return addReply(number, "403", PRIVACY);
    if (number === N(3)) return addReply(number, "409");
    if (number === N(4)) return { status: 500, json: { status: 500, error: "Internal Server Error" } };
    return addReply(number, "200");
  });
  fake.set("whatsappNumbers", (call) => {
    const number = numberOf(call);
    return number === N(5) ? notOnWhatsapp(number) : { status: 200, json: [{ exists: true, jid: `${number}@s.whatsapp.net`, number }] };
  });

  const runId = await begin(w, { source: { kind: "folder", folderId } });
  assert.equal((await runOf(w, runId)).status, "RUNNING");
  assert.equal(scheduled.length, 1, "the start kicks the run once");
  assert.equal(await drain(), 1);

  assert.deepEqual(await verdicts(w, runId), [
    ["Ana", "ADDED", null],
    ["Bia", "INVITED", null],
    ["Caio", "ALREADY_IN", null],
    ["Davi", "FAILED", "http_500"],
    ["Eva", "NO_WHATSAPP", null],
    ["Fábio", "SKIPPED", "opted_out"],
  ]);
  const items = await itemsOf(w, runId);
  assert.deepEqual(items.map((i) => i.code), ["200", "403", "409", null, null, null]);
  // Every try is stamped; the person Evolution found no account for, and the one who was left out, are not.
  assert.deepEqual(
    items.map((i) => i.processedAt?.toISOString() ?? null),
    ["2026-10-28T13:00:00.000Z", "2026-10-28T13:00:30.000Z", "2026-10-28T13:01:00.000Z", "2026-10-28T13:01:30.000Z", null, null],
  );
  const run = await runOf(w, runId);
  assert.equal(run.status, "DONE");
  assert.equal(run.finishedAt?.toISOString(), "2026-10-28T13:02:00.000Z");
  assert.deepEqual([run.lastDispatchAt, run.nextAttemptAt, run.waitReason, run.pausedReason, run.lastError], [null, null, null, null, null]);
  assert.equal(run.inviteUrl, "https://chat.whatsapp.com/AbC", "the link is fetched once and kept on the round");

  // One person at a time, with the pause of 30 s (random 0) between the tries, slept in pieces that renew the lease.
  assert.equal(clock.sleeps.reduce((a, b) => a + b, 0), 120_000);
  assert.ok(clock.sleeps.every((ms) => ms <= 10_000));

  // The only text is the invite of the person who was refused, with the link last.
  assert.deepEqual(texts(fake), [{ number: N(2), text: renderInvite(TEMPLATE, { nome: "Bia", grupo: "Ofertas" }, "https://chat.whatsapp.com/AbC") }]);
  assert.ok(String(texts(fake)[0]?.text).endsWith("\n\nhttps://chat.whatsapp.com/AbC"));
  assert.equal(String(texts(fake)[0]?.text).startsWith("Oi Bia! Este é o link para entrar no grupo Ofertas:"), true);
  // The adds, in order, one each; the person with no account was only asked about.
  assert.deepEqual(addedNumbers(fake), [N(1), N(2), N(3), N(4)]);
  assert.deepEqual(callsTo(fake, "whatsappNumbers").map(numberOf), [N(1), N(2), N(3), N(4), N(5)]);
  // Nothing else reached Evolution: every call is on a route the fake serves, none is the call that sends a link to a list.
  assert.deepEqual(fake.calls.filter((c) => c.route === null), []);
  assert.ok(fake.calls.every((c) => !c.path.toLowerCase().includes("sendinvite")));
  // The opted-out contact is in no request: not the number, not the name.
  const traffic = JSON.stringify(fake.calls);
  assert.ok(!traffic.includes(N(6)) && !traffic.includes("911110006") && !traffic.includes("Fábio"), "the opted-out contact reached Evolution");
});

check("window: outside 08:00-20:00 in São Paulo nothing goes out, the run waits for 08:00 and goes on then", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 2);
  clock.at = at("2026-10-28T23:05:00.000Z"); // 20:05 in São Paulo
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  const callsAtStart = fake.calls.length;

  assert.deepEqual(await runGroupAddRun(runId), { done: false, retryAfterSec: 42_900 });
  const waiting = await runOf(w, runId);
  assert.equal(waiting.status, "RUNNING");
  assert.equal(waiting.nextAttemptAt?.toISOString(), "2026-10-29T11:00:00.000Z");
  assert.equal(waiting.waitReason, "window");
  assert.equal(waiting.lastDispatchAt, null, "the lease is released while it waits");
  assert.equal(fake.calls.length, callsAtStart, "a call went out of the window");

  // Not due until 08:00, due at 08:00.
  assert.ok(!(await dueIn(w, at("2026-10-28T23:10:00.000Z"))).includes(runId));
  assert.ok(!(await dueIn(w, at("2026-10-29T10:59:59.000Z"))).includes(runId));
  assert.ok((await dueIn(w, at("2026-10-29T11:00:00.000Z"))).includes(runId));

  clock.at = at("2026-10-29T11:00:00.000Z");
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.equal((await runOf(w, runId)).status, "DONE");
  assert.deepEqual(addedNumbers(fake), [N(1), N(2)]);
});

check("window: a pause that would end after 20:00 becomes a wait until 08:00, and the person is not tried at 20:00", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 3);
  clock.at = at("2026-10-28T22:59:30.000Z"); // 19:59:30
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  assert.deepEqual(await runGroupAddRun(runId), { done: false, retryAfterSec: 43_230 });
  assert.deepEqual(addedNumbers(fake), [N(1)]);
  const run = await runOf(w, runId);
  assert.equal(run.nextAttemptAt?.toISOString(), "2026-10-29T11:00:00.000Z");
  assert.equal(run.waitReason, "window", "the window, not the pace, is what it waits for");
  assert.deepEqual(clock.sleeps, [], "it did not sleep through the night");

  clock.at = at("2026-10-29T11:00:00.000Z");
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.deepEqual(addedNumbers(fake), [N(1), N(2), N(3)]);
});

check("window: the clock is read again before the add and before the invite, so neither goes out after 20:00", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const [first, second] = await people(w, 2);
  clock.at = at("2026-10-28T22:59:59.000Z"); // 19:59:59
  // The number check takes the clock past 20:00, as a slow call would.
  fake.set("whatsappNumbers", (call) => {
    clock.at = at("2026-10-28T23:00:01.000Z");
    return { status: 200, json: [{ exists: true, jid: `${numberOf(call)}@s.whatsapp.net`, number: numberOf(call) }] };
  });
  const runId = await begin(w, { source: ofContacts([first, second]) });
  assert.deepEqual(await runGroupAddRun(runId), { done: false, retryAfterSec: 43_199 });
  assert.deepEqual(addedNumbers(fake), [], "the add went out after 20:00");
  let items = await itemsOf(w, runId);
  // The person was reserved and given back: pending, with no try stamped.
  assert.deepEqual(items.map((i) => [i.status, i.processedAt]), [["PENDING", null], ["PENDING", null]]);
  assert.equal((await runOf(w, runId)).waitReason, "window");

  // The next morning the add is refused for her privacy settings, and by then it is 20:00:01: the invite can't go out.
  fake.set("whatsappNumbers", (call) => ({ status: 200, json: [{ exists: true, jid: `${numberOf(call)}@s.whatsapp.net`, number: numberOf(call) }] }));
  fake.set("updateParticipant", (call) => {
    clock.at = at("2026-10-29T23:00:01.000Z");
    return addReply(numberOf(call), "403", PRIVACY);
  });
  clock.at = at("2026-10-29T22:59:50.000Z");
  assert.deepEqual(await runGroupAddRun(runId), { done: false, retryAfterSec: 43_199 });
  assert.deepEqual(texts(fake), [], "the invite went out after 20:00");
  items = await itemsOf(w, runId);
  assert.deepEqual(items.map((i) => [i.status, i.reason, i.code]), [["FAILED", "invite_failed", "403"], ["PENDING", null, null]]);
});

/** `count` people of a done round, all tried today (12:00Z) with this status. */
const triedToday = (status: GroupAddItemStatus, count: number): SeedItem[] =>
  Array.from({ length: count }, (_, i) => ({ name: `x${status}${i}`, phone: null, status, processedAt: at("2026-10-28T12:00:00.000Z") }));

/** A round of org B, done, on the same number (the fake links every instance to it), with these people tried today. */
const otherOrgTried = (w: World, items: SeedItem[]) => seedRun(w, { org: w.orgB, group: OTHER_GROUP, items });

/** Starts a round of two people in org A and runs it once, expecting it to wait for 08:00 tomorrow because of the cap. */
async function expectCapWait(ctx: Ctx, tried: (w: World) => Promise<unknown>): Promise<void> {
  const { fake, w } = await scenario(ctx);
  await tried(w);
  await people(w, 2);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  assert.deepEqual(await runGroupAddRun(runId), { done: false, retryAfterSec: 79_200 });
  assert.deepEqual(callsTo(fake, "updateParticipant", "whatsappNumbers", "sendText"), []);
  const run = await runOf(w, runId);
  assert.equal(run.status, "RUNNING");
  assert.equal(run.nextAttemptAt?.toISOString(), "2026-10-29T11:00:00.000Z");
  assert.equal(run.waitReason, "cap");
  assert.equal(run.lastDispatchAt, null);
  assert.deepEqual((await itemsOf(w, runId)).map((i) => i.status), ["PENDING", "PENDING"]);
}

check("cap: 100 ADDED today on the same number, in another organization, stop the run until 08:00 tomorrow", async (ctx) => {
  await expectCapWait(ctx, (w) => otherOrgTried(w, triedToday("ADDED", 100)));
});

check("cap: a try that ended in an invite or in a failure counts as much as an add", async (ctx) => {
  await expectCapWait(ctx, (w) =>
    otherOrgTried(w, [...triedToday("ADDED", 34), ...triedToday("INVITED", 33), ...triedToday("FAILED", 33)]),
  );
});

check("cap: only ADDED, INVITED and FAILED tried today count; yesterday (São Paulo) and the people left out do not", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const many = (status: GroupAddItemStatus, processedAt: Date | null): SeedItem[] =>
    Array.from({ length: 100 }, (_, i) => ({ name: `x${status}${i}`, phone: null, status, processedAt }));
  await seedRun(w, {
    org: w.orgB,
    group: OTHER_GROUP,
    items: [
      // One millisecond before the São Paulo day started: yesterday.
      ...many("ADDED", at("2026-10-28T02:59:59.999Z")),
      ...many("ALREADY_IN", at("2026-10-28T12:00:00.000Z")),
      ...many("NO_WHATSAPP", at("2026-10-28T12:00:00.000Z")),
      ...many("SKIPPED", null),
    ],
  });
  await people(w, 2);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.deepEqual(addedNumbers(fake), [N(1), N(2)]);
  assert.equal((await runOf(w, runId)).status, "DONE");
});

check("cap: a round that spends the day in the middle goes on by itself the next day, from 08:00", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  // 99 tried today: room for one more.
  await seedRun(w, {
    org: w.orgB,
    group: OTHER_GROUP,
    items: Array.from({ length: 99 }, (_, i) => ({ name: `x${i}`, phone: null, status: "ADDED" as const, processedAt: at("2026-10-28T11:00:00.000Z") })),
  });
  await people(w, 3);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  // The cap is looked at before the pause between people, so it doesn't sleep on the way to the morning.
  assert.deepEqual(await runGroupAddRun(runId), { done: false, retryAfterSec: 79_200 });
  assert.deepEqual(addedNumbers(fake), [N(1)]);
  assert.deepEqual((await itemsOf(w, runId)).map((i) => i.status), ["ADDED", "PENDING", "PENDING"]);
  const run = await runOf(w, runId);
  assert.equal(run.waitReason, "cap");
  assert.equal(run.nextAttemptAt?.toISOString(), "2026-10-29T11:00:00.000Z");

  // Tomorrow's day is empty.
  assert.ok(!(await dueIn(w, at("2026-10-29T10:59:00.000Z"))).includes(runId));
  assert.ok((await dueIn(w, at("2026-10-29T11:00:00.000Z"))).includes(runId));
  clock.at = at("2026-10-29T11:00:00.000Z");
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.deepEqual(addedNumbers(fake), [N(1), N(2), N(3)]);
  assert.equal((await runOf(w, runId)).status, "DONE");
});

check("one run at a time per number, in any organization: the second is QUEUED and rises, in order, when the first ends", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const idsA = await people(w, 2);
  const idsB = await people(w, 2, { org: w.orgB, from: 11 });
  const [one] = await people(w, 1, { from: 21 });

  // The same number (the fake links every instance to it): org B's round waits for org A's.
  const first = await begin(w, { source: ofContacts(idsA) });
  const second = await begin(w, { source: ofContacts(idsB), org: w.orgB, user: w.userB });
  const third = await begin(w, { source: ofContacts([one]), group: OTHER_GROUP });
  assert.deepEqual(
    await Promise.all([first, second, third].map(async (id) => (await runOf(w, id)).status)),
    ["RUNNING", "QUEUED", "QUEUED"],
  );
  assert.equal(scheduled.length, 1, "only the round that runs is kicked");

  // The first ends: the oldest of the queue rises, and is kicked.
  await scheduled.shift()?.();
  assert.deepEqual(
    await Promise.all([first, second, third].map(async (id) => (await runOf(w, id)).status)),
    ["DONE", "RUNNING", "QUEUED"],
  );
  assert.equal(scheduled.length, 1);
  assert.deepEqual(addedNumbers(fake), [N(1), N(2)], "the second round made a call before its turn");
  assert.notEqual((await runOf(w, second)).startedAt, null);
  // The last try of the first round was at 13:00:30: the pause of the number is owed to it, so the second round starts 30 s later.
  const owing = await runOf(w, second);
  assert.equal(owing.nextAttemptAt?.toISOString(), "2026-10-28T13:01:00.000Z");
  assert.equal(owing.waitReason, "pace");

  await drain();
  assert.deepEqual(
    await Promise.all([first, second, third].map(async (id) => (await runOf(w, id)).status)),
    ["DONE", "DONE", "DONE"],
  );
  // Each round went out through its own organization's connection, one after the other.
  assert.deepEqual(
    callsTo(fake, "updateParticipant").map((c) => [c.instance, numberOf(c)]),
    [["wga-a", N(1)], ["wga-a", N(2)], ["wga-b", N(11)], ["wga-b", N(12)], ["wga-a", N(21)]],
  );
  // And the pause between people held across both changes of round: every try is 30 s after the one before it.
  const tries = await w.prisma.whatsappGroupAddItem.findMany({
    where: { runId: { in: [first, second, third] }, processedAt: { not: null } },
    orderBy: { processedAt: "asc" },
    select: { processedAt: true },
  });
  assert.deepEqual(
    tries.map((t) => t.processedAt?.toISOString()),
    ["2026-10-28T13:00:00.000Z", "2026-10-28T13:00:30.000Z", "2026-10-28T13:01:00.000Z", "2026-10-28T13:01:30.000Z", "2026-10-28T13:02:00.000Z"],
  );
});

check("the pause between people holds across a cancel: the round that rises waits the pause from the last try", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const idsA = await people(w, 3);
  const idsB = await people(w, 1, { org: w.orgB, from: 11 });
  const first = await begin(w, { source: ofContacts(idsA) });
  const second = await begin(w, { source: ofContacts(idsB), org: w.orgB, user: w.userB });
  scheduled.length = 0;
  // The first round tries one person at 13:00:00 and is canceled during the pause that follows.
  assert.deepEqual(await runGroupAddRun(first, { budgetMs: 10_000 }), { done: false, retryAfterSec: 30 });
  assert.equal(await cancelGroupAdd(w.orgA, first), true);
  const rose = await runOf(w, second);
  assert.deepEqual([rose.status, rose.waitReason], ["RUNNING", "pace"]);
  assert.equal(rose.nextAttemptAt?.toISOString(), "2026-10-28T13:00:30.000Z");
  assert.equal(scheduled.length, 1);
  // Its first person goes out when the pause is over, not at once.
  assert.equal(await drain(), 1);
  assert.deepEqual(addedNumbers(fake), [N(1), N(11)]);
  assert.equal((await itemsOf(w, second))[0]?.processedAt?.toISOString(), "2026-10-28T13:00:30.000Z");
  assert.equal(clock.sleeps.reduce((a, b) => a + b, 0), 30_000);
});

check("the pause between people holds when a paused round is resumed right after another round ended on the number", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const idsA = await people(w, 2);
  const idsB = await people(w, 1, { org: w.orgB, from: 11 });
  const first = await begin(w, { source: ofContacts(idsA) });
  const second = await begin(w, { source: ofContacts(idsB), org: w.orgB, user: w.userB });
  assert.equal(await pauseGroupAdd(w.orgB, second), true); // queued, then paused: it holds the number
  // The first round runs to its end (tries at 13:00:00 and 13:00:30), and the paused one stays where it is.
  assert.equal(await drain(), 1);
  assert.deepEqual([(await runOf(w, first)).status, (await runOf(w, second)).status], ["DONE", "PAUSED"]);
  assert.deepEqual(await resumeGroupAdd(w.orgB, second), { ok: true });
  const back = await runOf(w, second);
  assert.deepEqual([back.status, back.waitReason], ["RUNNING", "pace"]);
  assert.equal(back.nextAttemptAt?.toISOString(), "2026-10-28T13:01:00.000Z");
  assert.equal(await drain(), 1);
  assert.equal((await itemsOf(w, second))[0]?.processedAt?.toISOString(), "2026-10-28T13:01:00.000Z");
  assert.deepEqual(addedNumbers(fake), [N(1), N(2), N(11)]);
});

check("a run that starts again owes its number the pause from the last try, keeps its own later time, and owes nothing for an old try", async (ctx) => {
  const { w } = await scenario(ctx);
  const triedAgo = (seconds: number): SeedItem[] => [
    { name: "x", phone: null, status: "ADDED", processedAt: new Date(clock.at.getTime() - seconds * 1000) },
  ];
  const mine: SeedItem[] = [{ name: "Pessoa 1", phone: N(1), status: "PENDING" }];
  const key = (n: number) => `${w.owner}${n}`; // one number per case
  // Case 1: another round tried someone on the number 10 s ago; the paused run's own time is long gone.
  await seedRun(w, { org: w.orgB, group: OTHER_GROUP, senderKey: key(1), items: triedAgo(10) });
  const stale = await seedRun(w, { status: "PAUSED", pausedReason: "disconnected", senderKey: key(1), nextAttemptAt: new Date(clock.at.getTime() - 3_600_000), items: mine });
  // Case 2: the same, but the paused run's own time is later than the pause owed (80 s from now against 20 s).
  await seedRun(w, { org: w.orgB, group: OTHER_GROUP, senderKey: key(2), items: triedAgo(10) });
  const own = await seedRun(w, { status: "PAUSED", pausedReason: "disconnected", senderKey: key(2), nextAttemptAt: new Date(clock.at.getTime() + 80_000), items: mine });
  // Case 3: the last try on the number was two hours ago, and a queued run rises.
  await seedRun(w, { org: w.orgB, group: OTHER_GROUP, senderKey: key(3), items: triedAgo(7200) });
  const queued = await seedRun(w, { status: "QUEUED", senderKey: key(3), items: mine });
  // Case 4: nobody ever tried anyone on the number.
  const fresh = await seedRun(w, { status: "QUEUED", senderKey: key(4), items: mine });

  const due = await dueIn(w);
  const nextOf = async (id: string) => (await runOf(w, id)).nextAttemptAt?.getTime() ?? null;
  const now = clock.at.getTime();
  assert.equal(await nextOf(stale), now + 20_000, "the pause owed to the last try");
  assert.equal(await nextOf(own), now + 80_000, "its own later time");
  assert.equal(await nextOf(queued), now - 7200_000 + 30_000, "an old try owes nothing");
  assert.equal(await nextOf(fresh), null);
  assert.equal((await runOf(w, stale)).status, "RUNNING");
  assert.equal((await runOf(w, queued)).status, "RUNNING");
  // Only the two that owe nothing now are due.
  assert.deepEqual([...due].sort(), [queued, fresh].sort());
});

check("cancel promotes the next run of the number; a paused run holds the queue until it is resumed", async (ctx) => {
  const { w } = await scenario(ctx);
  const [a1] = await people(w, 1);
  const [b1] = await people(w, 1, { org: w.orgB, from: 11 });
  const [a2] = await people(w, 1, { from: 21 });
  const first = await begin(w, { source: ofContacts([a1]) });
  const second = await begin(w, { source: ofContacts([b1]), org: w.orgB, user: w.userB });
  const statusOf = async (id: string) => (await runOf(w, id)).status;
  assert.deepEqual([await statusOf(first), await statusOf(second)], ["RUNNING", "QUEUED"]);
  assert.equal(scheduled.length, 1);
  scheduled.length = 0;

  // A queued run can be paused; paused, it holds the number.
  assert.equal(await pauseGroupAdd(w.orgB, second), true);
  const run2 = await runOf(w, second);
  assert.deepEqual([run2.status, run2.pausedReason], ["PAUSED", "manual"]);
  const third = await begin(w, { source: ofContacts([a2]), group: OTHER_GROUP });

  // The round that runs is canceled: its people stay PENDING, and nobody rises past the paused one.
  assert.equal(await cancelGroupAdd(w.orgA, first), true);
  const canceled = await runOf(w, first);
  assert.equal(canceled.status, "CANCELED");
  assert.ok(canceled.finishedAt !== null);
  assert.deepEqual((await itemsOf(w, first)).map((i) => i.status), ["PENDING"]);
  assert.deepEqual([await statusOf(second), await statusOf(third)], ["PAUSED", "QUEUED"]);
  assert.equal(scheduled.length, 0);
  // A canceled run is no one's to cancel again, or to pause, or to run.
  assert.equal(await cancelGroupAdd(w.orgA, first), false);
  assert.equal(await pauseGroupAdd(w.orgA, first), false);
  assert.deepEqual(await resumeGroupAdd(w.orgA, first), { ok: false, error: "not_found" });
  assert.deepEqual(await runGroupAddRun(first), { done: true });

  // Resumed, the paused run goes first: nothing else is running on the number.
  assert.deepEqual(await resumeGroupAdd(w.orgB, second), { ok: true });
  const resumed = await runOf(w, second);
  assert.deepEqual([resumed.status, resumed.pausedReason, resumed.waitReason], ["RUNNING", null, null]);
  assert.equal(scheduled.length, 1);
  assert.equal(await statusOf(third), "QUEUED");
  await drain();
  assert.deepEqual([await statusOf(second), await statusOf(third)], ["DONE", "DONE"]);
});

check("disconnected: the live state decides, not the row; the run pauses with no add and goes on when the number answers open", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 3);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  fake.set("connectionState", { status: 200, json: { instance: { state: "close" } } });
  // The row still says ACTIVE (it is the live state that changed).
  assert.equal(await w.prisma.integrationConnection.count({ where: { id: w.connA, status: "ACTIVE" } }), 1);

  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  let run = await runOf(w, runId);
  assert.deepEqual([run.status, run.pausedReason, run.lastDispatchAt], ["PAUSED", "disconnected", null]);
  assert.deepEqual(callsTo(fake, "whatsappNumbers", "updateParticipant", "sendText"), []);

  // Still closed: the cron leaves it be.
  assert.ok(!(await dueIn(w)).includes(runId));
  assert.equal((await runOf(w, runId)).status, "PAUSED");

  // Answering open again: the cron's list moves it back and lists it.
  fake.set("connectionState", { status: 200, json: { instance: { state: "open" } } });
  assert.ok((await dueIn(w)).includes(runId));
  run = await runOf(w, runId);
  assert.deepEqual([run.status, run.pausedReason], ["RUNNING", null]);
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.equal((await runOf(w, runId)).status, "DONE");
  assert.deepEqual(addedNumbers(fake), [N(1), N(2), N(3)]);
});

check("disconnected: a paused run whose number is back waits in the queue when another run has the number", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 1);
  const paused = await seedRun(w, { status: "PAUSED", pausedReason: "disconnected", items: [{ name: "Pessoa 1", phone: N(1), status: "PENDING" }] });
  // Another run took the number meanwhile (a state the queue prevents; seeded to see what the cron does with it).
  const running = await seedRun(w, { org: w.orgB, group: OTHER_GROUP, status: "RUNNING" });

  const due = await dueIn(w);
  assert.ok(!due.includes(paused), "listed while the number is busy");
  assert.ok(due.includes(running));
  assert.deepEqual([(await runOf(w, paused)).status, (await runOf(w, paused)).pausedReason], ["QUEUED", null]);
  assert.deepEqual(callsTo(fake, "updateParticipant"), []);
});

check("disconnected: a manual pause stays paused when the number is open", async (ctx) => {
  const { w } = await scenario(ctx);
  const [one] = await people(w, 1);
  const runId = await begin(w, { source: ofContacts([one]) });
  assert.equal(await pauseGroupAdd(w.orgA, runId), true);
  assert.ok(!(await dueIn(w)).includes(runId));
  assert.equal((await runOf(w, runId)).status, "PAUSED");
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
});

/**
 * A round that stopped because Evolution could not give the group at its first person: PAUSED, not_admin, with the note
 * "group_unreadable". The group is gone from `groups` (the fake answers 404); `readable` is what it was.
 */
async function unreadablePause(ctx: Ctx) {
  const scene = await scenario(ctx);
  const { fake, groups, w } = scene;
  await people(w, 2);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  const readable = groups[GROUP];
  delete groups[GROUP];
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.pausedReason, run.lastError, run.lastDispatchAt], ["PAUSED", "not_admin", "group_unreadable", null]);
  assert.deepEqual(callsTo(fake, "whatsappNumbers", "updateParticipant"), []);
  return { ...scene, runId, readable };
}

check("unreadable group: a round paused because the group could not be read comes back by itself when the group is readable and the number is admin", async (ctx) => {
  const { fake, groups, w, runId, readable } = await unreadablePause(ctx);
  groups[GROUP] = readable;
  // The cron's list reads the group, sees the number is admin, takes the round back and lists it.
  assert.ok((await dueIn(w)).includes(runId));
  const back = await runOf(w, runId);
  assert.deepEqual([back.status, back.pausedReason, back.lastError, back.waitReason, back.lastDispatchAt], ["RUNNING", null, null, null, null]);
  assert.deepEqual(callsTo(fake, "whatsappNumbers", "updateParticipant"), [], "taking it back already added someone");
  // And the round goes on from its first person.
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.deepEqual(await verdicts(w, runId), [["Pessoa 1", "ADDED", null], ["Pessoa 2", "ADDED", null]]);
  assert.equal((await runOf(w, runId)).status, "DONE");
});

check("unreadable group: a round that comes back behind another round of the number waits QUEUED", async (ctx) => {
  const { fake, groups, w, runId, readable } = await unreadablePause(ctx);
  groups[GROUP] = readable;
  // Another run took the number meanwhile (a state the queue prevents; seeded to see what the cron does with it).
  const running = await seedRun(w, { org: w.orgB, group: OTHER_GROUP, status: "RUNNING" });
  const due = await dueIn(w);
  assert.ok(!due.includes(runId), "listed while the number is busy");
  assert.ok(due.includes(running));
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.pausedReason, run.lastError], ["QUEUED", null, null]);
  assert.deepEqual(callsTo(fake, "updateParticipant"), []);
});

check("unreadable group: the poke of the tracking screen takes the round back the same way, and an organization that doesn't own it can't", async (ctx) => {
  const { groups, w, runId, readable } = await unreadablePause(ctx);
  groups[GROUP] = readable;
  const before = await runOf(w, runId);
  await pokeGroupAdd(w.orgB, runId); // not org B's run: not even looked at
  assert.deepEqual(await runOf(w, runId), before);
  assert.equal(scheduled.length, 0);
  await pokeGroupAdd(w.orgA, runId);
  const back = await runOf(w, runId);
  assert.deepEqual([back.status, back.pausedReason, back.lastError], ["RUNNING", null, null]);
  assert.equal(scheduled.length, 1, "the round was not kicked");
  assert.equal(await drain(), 1);
  assert.equal((await runOf(w, runId)).status, "DONE");
});

check("unreadable group: while it stays unreadable, or the number is not admin, or can't be told, the round stays paused with nothing written", async (ctx) => {
  const { fake, groups, w, runId } = await unreadablePause(ctx);
  const before = await runOf(w, runId);
  /** The cron's list and a poke each look at the group once; neither adds anyone or writes a thing to the run. */
  const stays = async (what: string) => {
    const looked = callsTo(fake, "findGroupInfos").length;
    assert.ok(!(await dueIn(w)).includes(runId), what);
    await pokeGroupAdd(w.orgA, runId);
    assert.equal(callsTo(fake, "findGroupInfos").length - looked, 2, `${what}: the group was not looked at`);
    assert.deepEqual(await runOf(w, runId), before, `${what}: the run was written`);
    assert.equal(scheduled.length, 0, what);
    assert.deepEqual(callsTo(fake, "whatsappNumbers", "updateParticipant", "sendText"), [], what);
  };
  await stays("not found");
  fake.set("findGroupInfos", { status: 500, json: { error: "boom" } });
  await stays("an error");
  fake.set("findGroupInfos", "drop");
  await stays("no answer");
  wire(w, fake, groups);
  // Readable, and every member has a number: the number is a member, not an admin.
  groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, null), FRIEND]);
  await stays("readable, the number is not admin");
  // Readable, but a member has no number to read and ours is not among the others: it could be that member.
  groups[GROUP] = groupJson(GROUP, "Ofertas", [FRIEND, NAMELESS]);
  await stays("readable, can't be told");
});

check("a pause for a definite not_admin, or for any other reason, is never taken back by itself", async (ctx) => {
  const { fake, groups, w } = await scenario(ctx);
  const [one] = await people(w, 1);
  const runId = await begin(w, { source: ofContacts([one]) });
  scheduled.length = 0;
  // The group is readable and the number is not admin: a definite answer, with no note.
  groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, null), FRIEND]);
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  const paused = await runOf(w, runId);
  assert.deepEqual([paused.status, paused.pausedReason, paused.lastError], ["PAUSED", "not_admin", null]);
  // The same pause with some other note, and the other reasons a round is paused for.
  const items: SeedItem[] = [{ name: "Pessoa 1", phone: N(1), status: "PENDING" }];
  const others: string[] = [];
  for (const [pausedReason, lastError] of [["not_admin", "something else"], ["error", "Error"], ["no_connection", null], ["manual", null]] as const) {
    others.push(await seedRun(w, { status: "PAUSED", pausedReason, lastError, senderKey: `${w.owner}${others.length + 1}`, items }));
  }
  const all = [runId, ...others];

  // Admin again. Nothing asks Evolution, nothing is written: only "Retomar" takes the first one back.
  groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, "admin"), FRIEND]);
  const before = await Promise.all(all.map((id) => runOf(w, id)));
  const calls = fake.calls.length;
  assert.deepEqual(await dueIn(w), []);
  for (const id of all) await pokeGroupAdd(w.orgA, id);
  assert.deepEqual(await Promise.all(all.map((id) => runOf(w, id))), before);
  assert.equal(fake.calls.length, calls, "Evolution was asked about a round that needs a manual resume");
  assert.equal(scheduled.length, 0);
  assert.deepEqual(await resumeGroupAdd(w.orgA, runId), { ok: true });
  assert.equal((await runOf(w, runId)).status, "RUNNING");
});

check("a paused round whose connection is another organization's, or is gone, is not taken back, and that connection is never asked", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const items: SeedItem[] = [{ name: "Pessoa 1", phone: N(1), status: "PENDING" }];
  const ids = [
    // The group is readable and the number admin on the fake: if the connection of org B were opened, it would come back.
    await seedRun(w, { status: "PAUSED", pausedReason: "not_admin", lastError: "group_unreadable", connectionId: w.connB, senderKey: `${w.owner}1`, items }),
    await seedRun(w, { status: "PAUSED", pausedReason: "not_admin", lastError: "group_unreadable", connectionId: "no-such-connection", senderKey: `${w.owner}2`, items }),
    await seedRun(w, { status: "PAUSED", pausedReason: "disconnected", connectionId: w.connB, senderKey: `${w.owner}3`, items }),
  ];
  const before = await Promise.all(ids.map((id) => runOf(w, id)));
  assert.deepEqual(await dueIn(w), []);
  for (const id of ids) await pokeGroupAdd(w.orgA, id);
  assert.deepEqual(await Promise.all(ids.map((id) => runOf(w, id))), before);
  assert.equal(fake.calls.length, 0, "a connection that is not the run's organization's was asked");
  assert.equal(scheduled.length, 0);
});

check("unavailable: Evolution not answering the state waits 5 minutes, with no add and no pause", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 2);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  fake.set("connectionState", { status: 500, json: {} });
  assert.deepEqual(await runGroupAddRun(runId), { done: false, retryAfterSec: 300 });
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.waitReason, run.lastDispatchAt], ["RUNNING", "unavailable", null]);
  assert.equal(run.nextAttemptAt?.toISOString(), "2026-10-28T13:05:00.000Z");
  assert.deepEqual(callsTo(fake, "updateParticipant", "whatsappNumbers"), []);
});

check("a run whose connection is gone, or is another organization's, pauses as no_connection and never reaches it", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const items = [{ name: "Pessoa 1", phone: N(1), status: "PENDING" as const }];
  const gone = await seedRun(w, { status: "RUNNING", connectionId: "no-such-connection", items });
  assert.deepEqual(await runGroupAddRun(gone), { done: true });
  // Org B's connection is a real one, with working credentials: the run of org A must not use it.
  const crossed = await seedRun(w, { status: "RUNNING", connectionId: w.connB, senderKey: `${w.owner}2`, items });
  assert.deepEqual(await runGroupAddRun(crossed), { done: true });
  for (const id of [gone, crossed]) {
    const run = await runOf(w, id);
    assert.deepEqual([run.status, run.pausedReason, run.lastDispatchAt], ["PAUSED", "no_connection", null]);
  }
  assert.equal(fake.calls.length, 0, "a call went out");
});

check("not admin: a number that stopped being admin pauses the run as not_admin with no add, and resuming asks again", async (ctx) => {
  const { fake, groups, w } = await scenario(ctx);
  await people(w, 2);
  // At the start it is admin; before the run goes it is not.
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, null), FRIEND, NAMELESS]);
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.pausedReason, run.lastDispatchAt], ["PAUSED", "not_admin", null]);
  assert.deepEqual(callsTo(fake, "whatsappNumbers", "updateParticipant"), []);
  assert.deepEqual((await itemsOf(w, runId)).map((i) => i.status), ["PENDING", "PENDING"]);

  // A paused round holds its group: no second round starts for it.
  assert.deepEqual(
    await startGroupAdd(w.orgA, w.userA, { source: { kind: "folder", folderId: null }, groupJid: GROUP, inviteText: TEMPLATE }),
    { ok: false, error: "already_running" },
  );
  // Resuming asks again: still not admin, still paused.
  assert.deepEqual(await resumeGroupAdd(w.orgA, runId), { ok: false, error: "not_admin" });
  assert.equal((await runOf(w, runId)).status, "PAUSED");
  // Admin again: it resumes and goes on.
  groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, "admin"), FRIEND, NAMELESS]);
  assert.deepEqual(await resumeGroupAdd(w.orgA, runId), { ok: true });
  assert.equal((await runOf(w, runId)).status, "RUNNING");
  assert.equal(await drain(), 1);
  assert.equal((await runOf(w, runId)).status, "DONE");
  assert.deepEqual(addedNumbers(fake), [N(1), N(2)]);
});

check("not admin: the start refuses a group the number does not run", async (ctx) => {
  const { groups, w } = await scenario(ctx);
  const [one] = await people(w, 1);
  groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, null), FRIEND]);
  assert.deepEqual(
    await startGroupAdd(w.orgA, w.userA, { source: ofContacts([one]), groupJid: GROUP, inviteText: TEMPLATE }),
    { ok: false, error: "not_admin" },
  );
  assert.deepEqual(
    await startGroupAdd(w.orgA, w.userA, { source: ofContacts([one]), groupJid: "120363999999999999@g.us", inviteText: TEMPLATE }),
    { ok: false, error: "not_found" },
  );
  assert.equal(await w.prisma.whatsappGroupAddRun.count({ where: { organizationId: w.orgA } }), 0);
});

check("not admin: after a try that failed the admin is asked again, so a number that lost it stops after one person", async (ctx) => {
  const { fake, groups, w } = await scenario(ctx);
  await people(w, 3);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  // The first add fails (the number lost its rights meanwhile); the second person must not be tried.
  fake.set("updateParticipant", () => {
    groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, null), FRIEND, NAMELESS]);
    return { status: 400, json: { status: 400, error: "Bad Request" } };
  });
  await drain();
  assert.deepEqual(addedNumbers(fake), [N(1)]);
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.pausedReason], ["PAUSED", "not_admin"]);
  assert.deepEqual((await itemsOf(w, runId)).map((i) => [i.status, i.reason]), [["FAILED", "http_400"], ["PENDING", null], ["PENDING", null]]);
});

check("two runners at the same time: one add per number, whoever has the lease", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 4);
  // A slow add keeps the first runner busy while the second one tries.
  fake.set("updateParticipant", async (call) => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return addReply(numberOf(call), "200");
  });
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  const results = await Promise.all([runGroupAddRun(runId), runGroupAddRun(runId)]);
  assert.deepEqual(results, [{ done: true }, { done: true }]);
  assert.deepEqual([...addedNumbers(fake)].sort(), [N(1), N(2), N(3), N(4)]);
  assert.deepEqual([...callsTo(fake, "whatsappNumbers").map(numberOf)].sort(), [N(1), N(2), N(3), N(4)]);
  assert.equal((await runOf(w, runId)).status, "DONE");
  assert.deepEqual((await itemsOf(w, runId)).map((i) => i.status), ["ADDED", "ADDED", "ADDED", "ADDED"]);
});

check("a second runner that starts while the first is mid-call does nothing: a live lease is respected", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 3);
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let held = false;
  fake.set("updateParticipant", async (call) => {
    if (!held) {
      held = true;
      await gate; // the first runner is inside this call, with the lease
    }
    return addReply(numberOf(call), "200");
  });
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  const first = runGroupAddRun(runId);
  await until(() => callsTo(fake, "updateParticipant").length >= 1, "the first add");
  const callsBefore = fake.calls.length;
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.equal(fake.calls.length, callsBefore, "a second runner made a call");
  assert.deepEqual((await itemsOf(w, runId)).map((i) => i.status), ["PROCESSING", "PENDING", "PENDING"]);
  open();
  await first;
  assert.deepEqual(addedNumbers(fake), [N(1), N(2), N(3)]);
  assert.equal((await runOf(w, runId)).status, "DONE");
});

check("a lease that expired under a stalled runner is taken over, and the person in its hands is never tried twice", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 3);
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let stalled = true;
  fake.set("updateParticipant", async (call) => {
    if (stalled && numberOf(call) === N(1)) {
      stalled = false;
      await gate; // the first runner hangs in this call
    }
    return addReply(numberOf(call), "200");
  });
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  const first = runGroupAddRun(runId);
  await until(() => callsTo(fake, "updateParticipant").length >= 1, "the stalled add");

  // Its lease runs out (no heartbeat for longer than the lease): a second runner takes over.
  await w.prisma.whatsappGroupAddRun.update({ where: { id: runId }, data: { lastDispatchAt: new Date(clock.at.getTime() - 5 * 60_000) } });
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  open();
  assert.deepEqual(await first, { done: true });

  // Each number was tried once: the stalled person is the one the new owner marked interrupted, never retried.
  assert.deepEqual([...addedNumbers(fake)].sort(), [N(1), N(2), N(3)]);
  assert.deepEqual(await verdicts(w, runId), [
    ["Pessoa 1", "FAILED", "interrupted"],
    ["Pessoa 2", "ADDED", null],
    ["Pessoa 3", "ADDED", null],
  ]);
  // The person was stamped when reserved, so the try that may have happened counts for the day.
  assert.notEqual((await itemsOf(w, runId))[0]?.processedAt, null);
  assert.equal((await runOf(w, runId)).status, "DONE");
});

check("a runner that loses its lease while it waits stops at the next piece, and leaves the new owner's lease alone", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 3);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  const thief = new Date(clock.at.getTime() + 3_600_000);
  const sleep = groupAddRuntime.sleep;
  groupAddRuntime.sleep = async (ms) => {
    await sleep(ms);
    // Another runner took the lease meanwhile: its stamp is not ours, so our next renewal has to fail.
    await w.prisma.whatsappGroupAddRun.update({ where: { id: runId }, data: { lastDispatchAt: thief } });
  };
  try {
    assert.deepEqual(await runGroupAddRun(runId), { done: true });
  } finally {
    groupAddRuntime.sleep = sleep;
  }
  assert.deepEqual(addedNumbers(fake), [N(1)], "it went on after losing the lease");
  const run = await runOf(w, runId);
  assert.equal(run.status, "RUNNING");
  assert.equal(run.lastDispatchAt?.getTime(), thief.getTime(), "the lease of the new owner was touched");
});

check("a pause that arrives while the runner is on a call is kept, with the pause between people, and the person is not lost", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 3);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  // While Evolution answers the add of the first person, someone pauses the run.
  let paused: boolean | null = null;
  fake.set("updateParticipant", async (call) => {
    paused = await pauseGroupAdd(w.orgA, runId);
    return addReply(numberOf(call), "200");
  });
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.equal(paused, true);
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.pausedReason, run.lastDispatchAt], ["PAUSED", "manual", null]);
  assert.equal(run.nextAttemptAt?.toISOString(), "2026-10-28T13:00:30.000Z", "the pause between people was lost");
  assert.deepEqual((await itemsOf(w, runId)).map((i) => i.status), ["ADDED", "PENDING", "PENDING"]);
  assert.deepEqual(addedNumbers(fake), [N(1)]);
});

check("a pause that arrives before the next person is reserved stops the run with nobody reserved", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 2);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  // The state of the number is asked after the run was read and before the person is reserved.
  let paused: boolean | null = null;
  fake.set("connectionState", async () => {
    paused = await pauseGroupAdd(w.orgA, runId);
    return { status: 200, json: { instance: { state: "open" } } };
  });
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.equal(paused, true);
  assert.deepEqual(callsTo(fake, "whatsappNumbers", "updateParticipant"), []);
  assert.deepEqual((await itemsOf(w, runId)).map((i) => [i.status, i.processedAt]), [["PENDING", null], ["PENDING", null]]);
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.pausedReason, run.lastDispatchAt], ["PAUSED", "manual", null]);
});

check("a cancel that arrives while the runner waits for Evolution is not undone by what the runner finds out", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 2);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  // The group is read first; while that call is out the run is canceled, and the answer says the number is not admin.
  let canceled: boolean | null = null;
  fake.set("findGroupInfos", async () => {
    canceled = await cancelGroupAdd(w.orgA, runId);
    return { status: 200, json: groupJson(GROUP, "Ofertas", [meIn(w, null), FRIEND, NAMELESS]) };
  });
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.equal(canceled, true);
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.pausedReason, run.lastDispatchAt], ["CANCELED", null, null]);
  assert.deepEqual(callsTo(fake, "whatsappNumbers", "updateParticipant"), []);
});

check("cancel settles the person a dead runner left PROCESSING, and leaves a live runner's person to it", async (ctx) => {
  const { w } = await scenario(ctx);
  const items: SeedItem[] = [
    { name: "Pessoa 1", phone: N(1), status: "PROCESSING" },
    { name: "Pessoa 2", phone: N(2), status: "PENDING" },
  ];
  const dead = await seedRun(w, { status: "RUNNING", senderKey: `${w.owner}1`, lastDispatchAt: new Date(clock.at.getTime() - 300_000), items });
  const alive = await seedRun(w, { status: "RUNNING", senderKey: `${w.owner}2`, lastDispatchAt: new Date(clock.at.getTime() - 10_000), items });
  const free = await seedRun(w, { status: "PAUSED", pausedReason: "error", senderKey: `${w.owner}3`, items });
  for (const id of [dead, alive, free]) assert.equal(await cancelGroupAdd(w.orgA, id), true);
  assert.deepEqual((await verdicts(w, dead)).map(([, status, reason]) => [status, reason]), [["FAILED", "interrupted"], ["PENDING", null]]);
  assert.deepEqual((await itemsOf(w, alive)).map((i) => i.status), ["PROCESSING", "PENDING"]);
  assert.deepEqual((await verdicts(w, free)).map(([, status, reason]) => [status, reason]), [["FAILED", "interrupted"], ["PENDING", null]]);
});

check("resume asks again: a number that is closed, an Evolution out of reach, a group that is gone or a connection that is gone keep the run paused", async (ctx) => {
  const { fake, groups, w } = await scenario(ctx);
  const items: SeedItem[] = [{ name: "Pessoa 1", phone: N(1), status: "PENDING" }];
  const runId = await seedRun(w, { status: "PAUSED", pausedReason: "manual", items });
  const stillPaused = async () => {
    const run = await runOf(w, runId);
    return [run.status, run.pausedReason];
  };
  fake.set("connectionState", { status: 200, json: { instance: { state: "close" } } });
  assert.deepEqual(await resumeGroupAdd(w.orgA, runId), { ok: false, error: "disconnected" });
  fake.set("connectionState", { status: 500, json: {} });
  assert.deepEqual(await resumeGroupAdd(w.orgA, runId), { ok: false, error: "unavailable" });
  fake.set("connectionState", { status: 200, json: { instance: { state: "open" } } });
  delete groups[GROUP];
  assert.deepEqual(await resumeGroupAdd(w.orgA, runId), { ok: false, error: "not_found" });
  const gone = await seedRun(w, { status: "PAUSED", pausedReason: "manual", senderKey: `${w.owner}2`, connectionId: "no-such-connection", items });
  assert.deepEqual(await resumeGroupAdd(w.orgA, gone), { ok: false, error: "no_connection" });
  // The connection of org B is not org A's to use.
  const crossed = await seedRun(w, { status: "PAUSED", pausedReason: "manual", senderKey: `${w.owner}3`, connectionId: w.connB, items });
  assert.deepEqual(await resumeGroupAdd(w.orgA, crossed), { ok: false, error: "no_connection" });
  assert.deepEqual(await stillPaused(), ["PAUSED", "manual"]);
  assert.equal(scheduled.length, 0);
  // Everything answering again: it resumes, and the run's own number is the one asked.
  groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, "admin"), FRIEND, NAMELESS]);
  fake.calls.length = 0;
  assert.deepEqual(await resumeGroupAdd(w.orgA, runId), { ok: true });
  assert.deepEqual(await stillPaused(), ["RUNNING", null]);
  assert.ok(fake.calls.length > 0 && fake.calls.every((c) => c.instance === "wga-a"));
  assert.equal(scheduled.length, 1);
});

check("a person left PROCESSING by a crash becomes FAILED / interrupted and is never asked about again", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const items: SeedItem[] = [
    { name: "Pessoa 1", phone: N(1), status: "PROCESSING" },
    { name: "Pessoa 2", phone: N(2), status: "PENDING" },
    { name: "Pessoa 3", phone: N(3), status: "PENDING" },
  ];
  // The lease of the dead runner is still live: nobody touches the run yet.
  const live = await seedRun(w, { status: "RUNNING", lastDispatchAt: new Date(clock.at.getTime() - 10_000), items });
  assert.deepEqual(await runGroupAddRun(live), { done: true });
  assert.deepEqual((await itemsOf(w, live)).map((i) => i.status), ["PROCESSING", "PENDING", "PENDING"]);
  assert.equal(fake.calls.length, 0);

  // A minute and a half later the lease is free.
  await w.prisma.whatsappGroupAddRun.update({ where: { id: live }, data: { lastDispatchAt: new Date(clock.at.getTime() - 120_000) } });
  assert.ok((await dueIn(w)).includes(live));
  assert.deepEqual(await runGroupAddRun(live), { done: true });
  assert.deepEqual(await verdicts(w, live), [
    ["Pessoa 1", "FAILED", "interrupted"],
    ["Pessoa 2", "ADDED", null],
    ["Pessoa 3", "ADDED", null],
  ]);
  assert.deepEqual(addedNumbers(fake), [N(2), N(3)], "the interrupted person was asked about");
  assert.deepEqual(callsTo(fake, "whatsappNumbers").map(numberOf), [N(2), N(3)]);
  assert.equal((await runOf(w, live)).status, "DONE");
});

check("an interrupted person who was already stamped keeps counting for the day", async (ctx) => {
  const { w } = await scenario(ctx);
  // Reserved at 12:59 and cut: WhatsApp may have been asked, so the try is stamped and counted.
  const runId = await seedRun(w, {
    status: "RUNNING",
    items: [{ name: "Pessoa 1", phone: N(1), status: "PROCESSING", processedAt: at("2026-10-28T12:59:00.000Z") }],
  });
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  const [item] = await itemsOf(w, runId);
  assert.deepEqual([item?.status, item?.reason], ["FAILED", "interrupted"]);
  assert.equal(
    await w.prisma.whatsappGroupAddItem.count({ where: { senderKey: w.owner, status: { in: ["ADDED", "INVITED", "FAILED"] }, processedAt: { gte: at("2026-10-28T03:00:00.000Z") } } }),
    1,
  );
});

check("an answer of {} (or none) to the add is FAILED / unknown_answer and no invite goes out", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 3);
  fake.set("updateParticipant", (call) => {
    const number = numberOf(call);
    if (number === N(1)) return { status: 201, json: {} };
    if (number === N(2)) return { status: 200, json: { updateParticipants: [] } };
    return { status: 201 };
  });
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  await drain();
  assert.deepEqual(await verdicts(w, runId), [
    ["Pessoa 1", "FAILED", "unknown_answer"],
    ["Pessoa 2", "FAILED", "unknown_answer"],
    ["Pessoa 3", "FAILED", "unknown_answer"],
  ]);
  assert.deepEqual(callsTo(fake, "inviteCode", "sendText"), []);
  // They were all asked, so they all count for the day.
  assert.ok((await itemsOf(w, runId)).every((i) => i.processedAt !== null && i.code === null));
});

check("the other ways an add can fail: no answer is uncertain, an HTTP error is http_<n>, any other code is FAILED with the code", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 3);
  fake.set("updateParticipant", (call) => {
    const number = numberOf(call);
    if (number === N(1)) return "drop";
    if (number === N(2)) return { status: 429, json: { error: "slow down" } };
    return addReply(number, "408");
  });
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  await drain();
  assert.deepEqual(
    (await itemsOf(w, runId)).map((i) => [i.status, i.reason, i.code]),
    [["FAILED", "uncertain", null], ["FAILED", "http_429", null], ["FAILED", null, "408"]],
  );
  assert.deepEqual(callsTo(fake, "sendText"), []);
  assert.equal((await runOf(w, runId)).status, "DONE");
});

check("the invite: the link is asked once per round, a missing link is no_invite_link and a refused text is invite_failed", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 4);
  fake.set("updateParticipant", (call) => addReply(numberOf(call), "403", PRIVACY));
  fake.set("sendText", (call) => (numberOf(call) === N(3) ? { status: 500, json: { error: "boom" } } : { status: 201, json: { key: {} } }));
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  await drain();
  assert.deepEqual(
    (await itemsOf(w, runId)).map((i) => [i.status, i.reason, i.code]),
    [["INVITED", null, "403"], ["INVITED", null, "403"], ["FAILED", "invite_failed", "403"], ["INVITED", null, "403"]],
  );
  assert.equal(callsTo(fake, "inviteCode").length, 1, "the link was asked more than once");
  assert.deepEqual(callsTo(fake, "sendText").map(numberOf), [N(1), N(2), N(3), N(4)]);

  // No link to give: nobody gets a text without it.
  const { fake: noLink, w: w2 } = await scenario(ctx);
  await people(w2, 2);
  noLink.set("updateParticipant", (call) => addReply(numberOf(call), "403", PRIVACY));
  noLink.set("inviteCode", { status: 404, json: { error: "No invite code" } });
  const second = await begin(w2, { source: { kind: "folder", folderId: null } });
  await drain();
  assert.deepEqual(
    (await itemsOf(w2, second)).map((i) => [i.status, i.reason]),
    [["FAILED", "no_invite_link"], ["FAILED", "no_invite_link"]],
  );
  assert.deepEqual(callsTo(noLink, "sendText"), []);
  assert.equal((await runOf(w2, second)).inviteUrl, null);
});

check("the invite text is what the person typed with {{nome}} and {{grupo}} filled in and the link on a line of its own, last", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const [ana] = [await contactOf(w, { name: "Ana Souza", phone: N(1) })];
  fake.set("updateParticipant", (call) => addReply(numberOf(call), "403", PRIVACY));
  const runId = await begin(w, { source: ofContacts([ana]), text: "{{ nome }}, entre no {{grupo}} para as ofertas." });
  await drain();
  assert.deepEqual(texts(fake), [
    { number: N(1), text: "Ana Souza, entre no Ofertas para as ofertas.\n\nhttps://chat.whatsapp.com/AbC" },
  ]);
  assert.equal((await runOf(w, runId)).status, "DONE");
});

// ── What an earlier round left in doubt ──────────────────────────────────────

/** A done round of org A for the group, long ago, whose people ended like this. */
const earlierRound = (w: World, items: SeedItem[]) =>
  seedRun(w, { items: items.map((item) => ({ processedAt: at("2026-10-20T12:00:00.000Z"), ...item })) });

// A person whose add or invite may have gone out (the runner died on them, the add or the text got no answer) is never tried again by itself.
for (const reason of ["interrupted", "uncertain", "invite_uncertain"] as const) {
  check(`an earlier round's ${reason} item for a number that is not in the group is SKIPPED / previous_uncertain with no call, and one that is in the group is ALREADY_IN`, async (ctx) => {
    const { fake, w } = await scenario(ctx);
    const folderId = await folderOf(w, "Clientes");
    await contactOf(w, { name: "Em dúvida", phone: N(1), folderId });
    await contactOf(w, { name: "Em dúvida e no grupo", phone: "(11) 91234-5678", folderId }); // a member of the group today
    await contactOf(w, { name: "Recusado", phone: N(2), folderId }); // a definite failure: tried again
    await earlierRound(w, [
      { name: "Em dúvida", phone: N(1), status: "FAILED", reason },
      { name: "Em dúvida e no grupo", phone: FRIEND_NUMBER, status: "FAILED", reason },
      { name: "Recusado", phone: N(2), status: "FAILED", reason: "http_500" },
    ]);

    const preview = await previewGroupAdd(w.orgA, w.userA, { kind: "folder", folderId }, GROUP);
    assert.ok(preview.ok);
    assert.deepEqual(preview.counts, { total: 3, pending: 1, alreadyIn: 1, noWhatsapp: 0, skipped: 1, leftGroup: 0, alreadyInvited: 0 });

    const runId = await begin(w, { source: { kind: "folder", folderId } });
    await drain();
    assert.deepEqual(await verdicts(w, runId), [
      ["Em dúvida", "SKIPPED", "previous_uncertain"],
      ["Em dúvida e no grupo", "ALREADY_IN", null],
      ["Recusado", "ADDED", null],
    ]);
    // Nobody was asked about the first two; the one that failed for sure was tried again.
    assert.deepEqual(addedNumbers(fake), [N(2)]);
    assert.deepEqual(callsTo(fake, "whatsappNumbers").map(numberOf), [N(2)]);
    assert.ok(!JSON.stringify(fake.calls).includes(N(1)), "the person in doubt reached Evolution");
    assert.equal((await itemsOf(w, runId))[0]?.processedAt, null);
    assert.equal((await runOf(w, runId)).status, "DONE");
  });
}

check("a doubt counts only for the same group and the same organization", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const [one, two] = await people(w, 2);
  const longAgo = at("2026-10-20T12:00:00.000Z");
  // Another group of the same organization, and the same group of another organization.
  await seedRun(w, { group: OTHER_GROUP, items: [{ name: "x", phone: N(1), status: "FAILED", reason: "uncertain", processedAt: longAgo }] });
  await seedRun(w, { org: w.orgB, items: [{ name: "y", phone: N(2), status: "FAILED", reason: "interrupted", processedAt: longAgo }] });
  const runId = await begin(w, { source: ofContacts([one, two]) });
  await drain();
  assert.deepEqual(await verdicts(w, runId), [["Pessoa 1", "ADDED", null], ["Pessoa 2", "ADDED", null]]);
  assert.deepEqual(addedNumbers(fake), [N(1), N(2)]);
});

check("an invite send that gets no answer is FAILED / invite_uncertain, a refused one is invite_failed, and the next round for the group leaves the first one alone", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const ids = await people(w, 3);
  fake.set("updateParticipant", (call) => {
    const number = numberOf(call);
    return number === N(3) ? addReply(number, "200") : addReply(number, "403", PRIVACY);
  });
  // The text of the first person gets no answer at all (it may have gone out); the second person's is refused.
  fake.set("sendText", (call) => (numberOf(call) === N(1) ? "drop" : { status: 500, json: { error: "boom" } }));
  const first = await begin(w, { source: ofContacts(ids) });
  await drain();
  assert.deepEqual(
    (await itemsOf(w, first)).map((i) => [i.status, i.reason, i.code]),
    [["FAILED", "invite_uncertain", "403"], ["FAILED", "invite_failed", "403"], ["ADDED", null, "200"]],
  );
  assert.deepEqual(callsTo(fake, "sendText").map(numberOf), [N(1), N(2)]);

  // The next round for the group, with the same people, once everything answers: the first is left alone, the refused one is tried again.
  fake.set("updateParticipant", (call) => addReply(numberOf(call), "200"));
  fake.set("sendText", { status: 201, json: {} });
  const asked = fake.calls.length;
  const second = await begin(w, { source: ofContacts(ids) });
  await drain();
  assert.deepEqual(await verdicts(w, second), [
    ["Pessoa 1", "SKIPPED", "previous_uncertain"],
    ["Pessoa 2", "ADDED", null],
    ["Pessoa 3", "LEFT_GROUP", null],
  ]);
  const again = fake.calls.slice(asked);
  assert.deepEqual(again.filter((c) => c.route === "updateParticipant").map(numberOf), [N(2)]);
  assert.ok(!JSON.stringify(again).includes(N(1)), "the person who may have got the text was asked about again");
});

check("startGroupAdd twice: the second answers already_running; two clicks at once make one round; a canceled one frees the group", async (ctx) => {
  const { w } = await scenario(ctx);
  const ids = await people(w, 3);
  const input = { source: ofContacts(ids), groupJid: GROUP, inviteText: TEMPLATE };
  const first = await startGroupAdd(w.orgA, w.userA, input);
  assert.ok(first.ok);
  assert.deepEqual(await startGroupAdd(w.orgA, w.userA, input), { ok: false, error: "already_running" });
  assert.equal(await w.prisma.whatsappGroupAddRun.count({ where: { organizationId: w.orgA } }), 1);
  // Another group is another round (it waits for the number).
  assert.ok((await startGroupAdd(w.orgA, w.userA, { ...input, groupJid: OTHER_GROUP })).ok);
  // The same group in another organization is another round too.
  const [other] = await people(w, 1, { org: w.orgB, from: 31 });
  assert.ok((await startGroupAdd(w.orgB, w.userB, { source: ofContacts([other]), groupJid: GROUP, inviteText: TEMPLATE })).ok);

  assert.equal(await cancelGroupAdd(w.orgA, first.runId), true);
  const again = await startGroupAdd(w.orgA, w.userA, input);
  assert.ok(again.ok);
  assert.notEqual(again.runId, first.runId);

  // Two clicks at the same moment: one round.
  await w.prisma.whatsappGroupAddRun.deleteMany({ where: { organizationId: w.orgA } });
  const both = await Promise.all([startGroupAdd(w.orgA, w.userA, input), startGroupAdd(w.orgA, w.userA, input)]);
  assert.deepEqual(both.map((r) => r.ok).sort(), [false, true]);
  assert.deepEqual(both.filter((r) => !r.ok), [{ ok: false, error: "already_running" }]);
  assert.equal(await w.prisma.whatsappGroupAddRun.count({ where: { organizationId: w.orgA, groupJid: GROUP } }), 1);
  // A paused or done round: the group is held while paused, free once done.
  const held = both.find((r) => r.ok);
  assert.ok(held?.ok);
  assert.equal(await pauseGroupAdd(w.orgA, held.runId), true);
  assert.deepEqual(await startGroupAdd(w.orgA, w.userA, input), { ok: false, error: "already_running" });
});

check("startGroupAdd answers the group's name as the round keeps it ('Grupo' when it has none), and not its JID: the audit entry records the name", async (ctx) => {
  const { groups, w } = await scenario(ctx);
  const ids = await people(w, 2);
  // The old kind of JID holds the phone of whoever made the group, and the new kind is a group without a name.
  const OLD_KIND = "5511987654321-1618000000@g.us";
  const NO_NAME = "120363000000000013@g.us";
  groups[OLD_KIND] = groupJson(OLD_KIND, "Clientes VIP", [meIn(w, "admin"), FRIEND]);
  groups[NO_NAME] = groupJson(NO_NAME, "", [meIn(w, "admin"), FRIEND]);
  const start = (groupJid: string) => startGroupAdd(w.orgA, w.userA, { source: ofContacts(ids), groupJid, inviteText: TEMPLATE });

  for (const [groupJid, name] of [
    [GROUP, "Ofertas"],
    [OLD_KIND, "Clientes VIP"],
    [NO_NAME, "Grupo"],
  ] as const) {
    const res = await start(groupJid);
    assert.ok(res.ok, groupJid);
    assert.equal(res.groupName, name);
    assert.equal((await runOf(w, res.runId)).groupName, name, "the answer is the name the round was written with");
    // The answer is the round and its name: nothing of the JID in it, least of all the number inside the old kind.
    assert.deepEqual(Object.keys(res).sort(), ["groupName", "ok", "runId"]);
    assert.ok(!JSON.stringify(res).includes("5511987654321"), "the answer carries the number of the group's creator");
  }
});

check("a group that would pass 1,024 people: the overflow starts FAILED / group_full, never asked about and not counted for the day", async (ctx) => {
  const { fake, groups, w } = await scenario(ctx);
  groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, "admin"), FRIEND], { size: 1021 }); // room for 3
  const ids = await people(w, 6);
  const runId = await begin(w, { source: ofContacts(ids) });
  assert.deepEqual(
    (await itemsOf(w, runId)).map((i) => [i.status, i.reason, i.processedAt]),
    [
      ["PENDING", null, null],
      ["PENDING", null, null],
      ["PENDING", null, null],
      ["FAILED", "group_full", null],
      ["FAILED", "group_full", null],
      ["FAILED", "group_full", null],
    ],
  );
  await drain();
  assert.deepEqual(addedNumbers(fake), [N(1), N(2), N(3)]);
  assert.equal((await runOf(w, runId)).status, "DONE");
  assert.equal(
    await w.prisma.whatsappGroupAddItem.count({ where: { senderKey: w.owner, status: { in: ["ADDED", "INVITED", "FAILED"] }, processedAt: { not: null } } }),
    3,
  );
  // A full group takes nobody.
  groups[GROUP] = groupJson(GROUP, "Ofertas", [meIn(w, "admin"), FRIEND], { size: 1024 });
  await w.prisma.whatsappGroupAddRun.deleteMany({ where: { organizationId: w.orgA } });
  const full = await begin(w, { source: ofContacts(ids) });
  assert.ok((await itemsOf(w, full)).every((i) => i.status === "FAILED" && i.reason === "group_full"));
  assert.equal(await drain(), 1);
  assert.equal((await runOf(w, full)).status, "DONE");
});

check("a contact whose number belongs to an opted-out contact outside the folder is left out and never asked about", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const folderId = await folderOf(w, "Clientes");
  await contactOf(w, { name: "Na pasta", phone: N(1), folderId }); // no opt-out of its own
  await contactOf(w, { name: "Outra", phone: N(2), folderId });
  // The same person, typed another way, in another place of the CRM, asked not to be contacted.
  await contactOf(w, { name: "Mesma pessoa", phone: "(11) 91111-0001", optedOut: true });
  const preview = await previewGroupAdd(w.orgA, w.userA, { kind: "folder", folderId }, GROUP);
  assert.ok(preview.ok);
  assert.deepEqual([preview.counts.pending, preview.counts.skipped], [1, 1]);

  const runId = await begin(w, { source: { kind: "folder", folderId } });
  await drain();
  assert.deepEqual(await verdicts(w, runId), [
    ["Na pasta", "SKIPPED", "opted_out"],
    ["Outra", "ADDED", null],
  ]);
  const traffic = JSON.stringify(fake.calls);
  assert.ok(!traffic.includes(N(1)) && !traffic.includes("911110001"), "the opted-out person reached Evolution");
  // And of org B's opt-out, nothing: it is another organization's record.
  await contactOf(w, { name: "Da outra empresa", phone: N(3), optedOut: true, org: w.orgB });
  const free = await contactOf(w, { name: "Livre", phone: N(3) });
  const second = await begin(w, { source: ofContacts([free]), group: OTHER_GROUP });
  await drain();
  assert.deepEqual(await verdicts(w, second), [["Livre", "ADDED", null]]);
});

check("an opt-out made after the start is honored at the person's turn: the contact's own, and the same number on another contact of the organization", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const [one, two, three, four, five] = await people(w, 5);
  const runId = await begin(w, { source: ofContacts([one, two, three, four, five]) });
  scheduled.length = 0;
  // The first person goes (at 13:00:00). Then, before the others' turn, three of the four who are left ask not to be contacted.
  assert.deepEqual(await runGroupAddRun(runId, { budgetMs: 10_000 }), { done: false, retryAfterSec: 30 });
  assert.deepEqual(addedNumbers(fake), [N(1)]);
  await w.prisma.contact.update({ where: { id: two }, data: { optedOut: true } }); // the contact itself
  await contactOf(w, { name: "Mesma pessoa", phone: "(11) 91111-0003", optedOut: true }); // the number of the third, on a contact outside the round
  await contactOf(w, { name: "Outro formato", phone: "(11) 91111-0005", optedOut: true }); // the fifth's number, written another way
  await contactOf(w, { name: "Outra empresa", phone: N(4), optedOut: true, org: w.orgB }); // another organization's opt-out means nothing here

  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.deepEqual(await verdicts(w, runId), [
    ["Pessoa 1", "ADDED", null],
    ["Pessoa 2", "SKIPPED", "opted_out"],
    ["Pessoa 3", "SKIPPED", "opted_out"],
    ["Pessoa 4", "ADDED", null],
    ["Pessoa 5", "SKIPPED", "opted_out"],
  ]);
  // Nobody was asked about them: not the number check, not the add.
  assert.deepEqual(addedNumbers(fake), [N(1), N(4)]);
  assert.deepEqual(callsTo(fake, "whatsappNumbers").map(numberOf), [N(1), N(4)]);
  const traffic = JSON.stringify(fake.calls);
  assert.ok(!traffic.includes(N(2)) && !traffic.includes(N(3)) && !traffic.includes(N(5)), "an opted-out person reached Evolution");
  // Left out without a call: no try stamped on them, and no pause spent: the fourth goes out when the first one's pause ends.
  const items = await itemsOf(w, runId);
  assert.deepEqual(items.map((i) => i.processedAt?.toISOString() ?? null), ["2026-10-28T13:00:00.000Z", null, null, "2026-10-28T13:00:30.000Z", null]);
  assert.equal((await runOf(w, runId)).status, "DONE");
});

check("pause, resume and cancel: a pause is kept across a resume, the pause between people is not skipped", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 3);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  // One person, then the budget ends: the next one is due 30 s later.
  const partial = await runGroupAddRun(runId, { budgetMs: 10_000 });
  assert.deepEqual(partial, { done: false, retryAfterSec: 30 });
  assert.deepEqual(addedNumbers(fake), [N(1)]);
  const pausedAt = await runOf(w, runId);
  assert.equal(pausedAt.nextAttemptAt?.toISOString(), "2026-10-28T13:00:30.000Z");

  assert.equal(await pauseGroupAdd(w.orgA, runId), true);
  assert.equal(await pauseGroupAdd(w.orgA, runId), false, "already paused");
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.deepEqual(addedNumbers(fake), [N(1)]);
  assert.deepEqual(await resumeGroupAdd(w.orgA, runId), { ok: true });
  assert.deepEqual(await resumeGroupAdd(w.orgA, runId), { ok: false, error: "already_running" });
  const resumed = await runOf(w, runId);
  assert.deepEqual([resumed.status, resumed.pausedReason, resumed.waitReason], ["RUNNING", null, null]);
  assert.equal(resumed.nextAttemptAt?.toISOString(), "2026-10-28T13:00:30.000Z", "the pause between people survived the pause");
  assert.equal(scheduled.length, 1);

  // Canceled in the middle: the rest stays PENDING, and the runner stops.
  assert.equal(await cancelGroupAdd(w.orgA, runId), true);
  assert.deepEqual(await drain(), 1);
  assert.deepEqual(addedNumbers(fake), [N(1)]);
  assert.deepEqual((await itemsOf(w, runId)).map((i) => i.status), ["ADDED", "PENDING", "PENDING"]);
  assert.equal((await runOf(w, runId)).status, "CANCELED");
});

check("a pause or a cancel during the wait between two people is seen at the next piece of the wait and releases the lease", async (ctx) => {
  const { w } = await scenario(ctx);
  await people(w, 3);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  // The pause happens while the runner sleeps its 30 s.
  let sleeps = 0;
  const sleep = groupAddRuntime.sleep;
  groupAddRuntime.sleep = async (ms) => {
    await sleep(ms);
    if (++sleeps === 1) assert.equal(await pauseGroupAdd(w.orgA, runId), true);
  };
  try {
    assert.deepEqual(await runGroupAddRun(runId), { done: true });
  } finally {
    groupAddRuntime.sleep = sleep;
  }
  assert.equal(sleeps, 1, "it slept on after the pause");
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.pausedReason, run.lastDispatchAt], ["PAUSED", "manual", null]);
  assert.deepEqual((await itemsOf(w, runId)).map((i) => i.status), ["ADDED", "PENDING", "PENDING"]);
});

check("a queue job gets a budget: it works until the budget ends and says when to come back", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  await people(w, 4);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  // 50 s: the first person at 0 s, the second at 30 s; the third is due at 60 s, past the budget.
  assert.deepEqual(await runGroupAddRun(runId, { budgetMs: 50_000 }), { done: false, retryAfterSec: 30 });
  assert.deepEqual(addedNumbers(fake), [N(1), N(2)]);
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.waitReason, run.lastDispatchAt], ["RUNNING", "pace", null]);
  assert.equal(run.nextAttemptAt?.toISOString(), "2026-10-28T13:01:00.000Z");
  // The job that comes back finishes it.
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.deepEqual(addedNumbers(fake), [N(1), N(2), N(3), N(4)]);
});

check("a run with nobody left to try finishes at once, whatever the hour, the day or the pause", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  // Everyone is already in the group: nothing to do, and no reason to wait for 08:00.
  await contactOf(w, { name: "Já estava", phone: FRIEND_NUMBER });
  clock.at = at("2026-10-28T23:30:00.000Z"); // 20:30
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  assert.deepEqual(await runGroupAddRun(runId), { done: true });
  assert.deepEqual(await verdicts(w, runId), [["Já estava", "ALREADY_IN", null]]);
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.nextAttemptAt, run.waitReason, run.lastDispatchAt], ["DONE", null, null, null]);
  assert.deepEqual(callsTo(fake, "updateParticipant", "whatsappNumbers"), []);

  // And the last person of a round does not make it wait out the pause after them.
  const [one] = await people(w, 1);
  const second = await begin(w, { source: ofContacts([one]), group: OTHER_GROUP });
  clock.at = at("2026-10-29T13:00:00.000Z");
  assert.deepEqual(await runGroupAddRun(second), { done: true });
  assert.equal((await runOf(w, second)).status, "DONE");
  assert.deepEqual(clock.sleeps, []);
});

check("the cron's list: running and due only, a live lease is left alone, and a queue nobody holds is started", async (ctx) => {
  const { w } = await scenario(ctx);
  const pending: SeedItem[] = [{ name: "Pessoa 1", phone: N(1), status: "PENDING" }];
  const key = (n: number) => `${w.owner}${n}`; // one number per seeded round: only one may run on a number
  const free = await seedRun(w, { status: "RUNNING", senderKey: key(1), items: pending });
  const later = await seedRun(w, { status: "RUNNING", senderKey: key(2), nextAttemptAt: new Date(clock.at.getTime() + 300_000), items: pending });
  const live = await seedRun(w, { status: "RUNNING", senderKey: key(3), lastDispatchAt: new Date(clock.at.getTime() - 60_000), items: pending });
  const stale = await seedRun(w, { status: "RUNNING", senderKey: key(4), lastDispatchAt: new Date(clock.at.getTime() - 120_000), items: pending });
  const late = await seedRun(w, { status: "RUNNING", senderKey: key(5), nextAttemptAt: new Date(clock.at.getTime() - 1_000), items: pending });
  for (const [n, status] of [[6, "PAUSED"], [7, "DONE"], [8, "CANCELED"]] as const) {
    await seedRun(w, { status, pausedReason: status === "PAUSED" ? "manual" : null, senderKey: key(n), items: pending });
  }
  // Queued behind a round that runs, and behind one that is paused: stays queued.
  const behindRunning = await seedRun(w, { status: "QUEUED", senderKey: key(1), group: OTHER_GROUP, items: pending });
  const behindPaused = await seedRun(w, { status: "QUEUED", senderKey: key(6), group: OTHER_GROUP, items: pending });
  // Nobody holds this number: a crash between the end of a round and the next one's turn left it queued.
  const orphan = await seedRun(w, { status: "QUEUED", senderKey: key(9), items: pending });

  const due = await dueIn(w);
  assert.deepEqual([...due].sort(), [free, stale, late, orphan].sort());
  assert.ok(![later, live, behindRunning, behindPaused].some((id) => due.includes(id)));
  assert.equal((await runOf(w, orphan)).status, "RUNNING");
  assert.deepEqual([(await runOf(w, behindRunning)).status, (await runOf(w, behindPaused)).status], ["QUEUED", "QUEUED"]);
  // Later: the one that was waiting for its pause is due.
  assert.ok((await dueIn(w, new Date(clock.at.getTime() + 300_000))).includes(later));
});

check("promoteQueuedRuns: the oldest queued run of the number rises, one at a time, and a number nobody queued for gives none", async (ctx) => {
  const { w } = await scenario(ctx);
  const older = await seedRun(w, { status: "QUEUED", createdAt: at("2026-10-27T10:00:00.000Z"), items: [] });
  const newer = await seedRun(w, { org: w.orgB, status: "QUEUED", createdAt: at("2026-10-27T11:00:00.000Z"), items: [] });
  assert.deepEqual(await promoteQueuedRuns(`${w.owner}-nobody`), []);
  assert.deepEqual(await promoteQueuedRuns(w.owner), [older]);
  assert.deepEqual(await promoteQueuedRuns(w.owner), [], "a run is already running on the number");
  assert.deepEqual([(await runOf(w, older)).status, (await runOf(w, newer)).status], ["RUNNING", "QUEUED"]);
  assert.notEqual((await runOf(w, older)).startedAt, null);
  // Two promotions at the same moment still raise one.
  await w.prisma.whatsappGroupAddRun.update({ where: { id: older }, data: { status: "DONE" } });
  const both = await Promise.all([promoteQueuedRuns(w.owner), promoteQueuedRuns(w.owner)]);
  assert.deepEqual(both.flat(), [newer]);
});

check("poke: a run that is due is kicked, one that isn't, or is another organization's, is not", async (ctx) => {
  const { w } = await scenario(ctx);
  const item: SeedItem[] = [{ name: "Pessoa 1", phone: N(1), status: "PENDING" }];
  const due = await seedRun(w, { status: "RUNNING", senderKey: `${w.owner}1`, items: item });
  const waiting = await seedRun(w, { status: "RUNNING", senderKey: `${w.owner}2`, nextAttemptAt: new Date(clock.at.getTime() + 60_000), items: item });
  const leased = await seedRun(w, { status: "RUNNING", senderKey: `${w.owner}3`, lastDispatchAt: new Date(clock.at.getTime() - 30_000), items: item });

  await pokeGroupAdd(w.orgA, waiting);
  await pokeGroupAdd(w.orgA, leased);
  await pokeGroupAdd(w.orgB, due); // org B has no such run
  await pokeGroupAdd(w.orgA, "no-such-run");
  assert.equal(scheduled.length, 0);
  await pokeGroupAdd(w.orgA, due);
  assert.equal(scheduled.length, 1);
});

check("poke: a paused run whose number is back is moved to RUNNING and kicked", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const runId = await seedRun(w, { status: "PAUSED", pausedReason: "disconnected", items: [{ name: "Pessoa 1", phone: N(1), status: "PENDING" }] });
  fake.set("connectionState", { status: 200, json: { instance: { state: "close" } } });
  await pokeGroupAdd(w.orgA, runId);
  assert.equal((await runOf(w, runId)).status, "PAUSED");
  assert.equal(scheduled.length, 0);
  fake.set("connectionState", { status: 200, json: { instance: { state: "open" } } });
  await pokeGroupAdd(w.orgA, runId);
  assert.equal((await runOf(w, runId)).status, "RUNNING");
  assert.equal(scheduled.length, 1);
});

// ── The cron route and the queue job ─────────────────────────────────────────

/** The secret the route is called with here: the real one of .env is never used, and none is needed in .env. */
const CRON_SECRET = "e2e-cron-secret-0123456789abcdef0123456789";

/** A call to the cron route as the hPanel makes it; `authorization` is the header as sent, or none. */
const callCron = (authorization?: string): Promise<Response> =>
  cronWhatsappGroups(new Request("http://localhost/api/cron/whatsapp-groups", authorization === undefined ? {} : { headers: { authorization } }));

/** The one person a seeded run still has to try: Pessoa n, with the number N(n). */
const waiting = (n: number): SeedItem[] => [{ name: `Pessoa ${n}`, phone: N(n), status: "PENDING" }];

/**
 * The runs outside the two throwaway organizations that the route would act on. The route reads every run of the database (it
 * is the cron: no organization, no scope), so a run of someone's manual tests that is open would be promoted, taken back or
 * kicked by it. The checks that call it as authorized do so only when there is none, and say so when there is.
 */
async function openRunsOutside(w: World): Promise<number> {
  return w.prisma.whatsappGroupAddRun.count({
    where: { organizationId: { notIn: [w.orgA, w.orgB] }, status: { in: ["QUEUED", "RUNNING", "PAUSED"] } },
  });
}

/** True when the route can be called as authorized without touching a run that is not the check's. */
async function routeIsSafeToCall(w: World): Promise<boolean> {
  const outside = await openRunsOutside(w);
  if (outside === 0) return true;
  console.log(`  ! skipped: ${outside} open run(s) outside the throwaway organizations would be acted on by the cron route`);
  return false;
}

check("the cron route: no secret, a wrong one, another scheme, or no secret configured is 401, and nothing is touched", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const due = await seedRun(w, { status: "RUNNING", items: waiting(1) });
  const stale = await seedRun(w, { status: "RUNNING", senderKey: `${w.owner}2`, lastDispatchAt: new Date(clock.at.getTime() - 120_000), items: waiting(2) });
  const before = [await runOf(w, due), await runOf(w, stale)];

  const wrong: (string | undefined)[] = [
    undefined,
    "",
    "Bearer",
    "Bearer ",
    `Bearer ${CRON_SECRET}x`,
    `Bearer ${CRON_SECRET.slice(0, -1)}`,
    `Bearer ${CRON_SECRET.toUpperCase()}`,
    `bearer ${CRON_SECRET}`,
    `Basic ${CRON_SECRET}`,
    `Bearer  ${CRON_SECRET}`,
    CRON_SECRET,
  ];
  // (A space before or after the header is not in the list on purpose: a Headers object trims it, as an HTTP server does.)
  for (const header of wrong) {
    const res = await callCron(header);
    assert.equal(res.status, 401, JSON.stringify(header));
    assert.equal(await res.text(), "Unauthorized");
  }
  // These are wrong against the secret of this check; the right header, which the checks below use, is let in.
  const secret = env.CRON_SECRET;
  assert.equal(secret, CRON_SECRET);

  // With no secret configured the route fails closed, even for a caller who sends what looks like one.
  env.CRON_SECRET = undefined;
  try {
    for (const header of [`Bearer ${CRON_SECRET}`, "Bearer undefined", "Bearer ", undefined]) {
      assert.equal((await callCron(header)).status, 401, `no secret configured: ${JSON.stringify(header)}`);
    }
  } finally {
    env.CRON_SECRET = secret;
  }

  // Nothing was kicked, taken or written: the guard comes before anything else.
  assert.equal(scheduled.length, 0);
  assert.equal(fake.calls.length, 0);
  assert.deepEqual([await runOf(w, due), await runOf(w, stale)], before);
});

check("the cron route: kicks the runs that are due and only those, and a round with a live lease is left alone", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  if (!(await routeIsSafeToCall(w))) return;
  const now = clock.at.getTime();
  const lease = groupAddRuntime.leaseMs;
  const key = (n: number) => `${w.owner}${n}`; // one number per round that is not meant to run
  // The three that are due run on the number of the fake (the only one it knows as admin of the group).
  const free = await seedRun(w, { status: "RUNNING", senderKey: w.owner, items: waiting(1) });
  const lapsed = await seedRun(w, { status: "RUNNING", senderKey: w.owner, lastDispatchAt: new Date(now - (lease + 1)), items: waiting(2) });
  const ready = await seedRun(w, { status: "RUNNING", senderKey: w.owner, nextAttemptAt: new Date(now - 1_000), items: waiting(3) });
  // The ones that are not: a lease that has not run out (at the very edge of it, and well inside it), a wait that has not
  // ended, a pause by hand, and a round that is over.
  const edge = await seedRun(w, { status: "RUNNING", senderKey: key(1), lastDispatchAt: new Date(now - lease), items: waiting(4) });
  const held = await seedRun(w, { status: "RUNNING", senderKey: key(2), lastDispatchAt: new Date(now - 30_000), items: waiting(5) });
  const later = await seedRun(w, { status: "RUNNING", senderKey: key(3), nextAttemptAt: new Date(now + 60_000), items: waiting(6) });
  const manual = await seedRun(w, { status: "PAUSED", pausedReason: "manual", senderKey: key(4), items: waiting(7) });
  const over = await seedRun(w, { status: "DONE", senderKey: key(5), items: [] });
  const untouched = [edge, held, later, manual, over];
  const before = await Promise.all(untouched.map((id) => runOf(w, id)));

  const res = await callCron(`Bearer ${CRON_SECRET}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, resumed: 3 });
  assert.equal(scheduled.length, 3, "one background task for each round that is due");
  assert.deepEqual(callsTo(fake, "updateParticipant"), [], "the route only schedules: nobody is added until the tasks run");

  // The tasks are the three that were due: those are the people who were added.
  assert.equal(await drain(), 3);
  assert.deepEqual([...addedNumbers(fake)].sort(), [N(1), N(2), N(3)]);
  assert.deepEqual(await Promise.all([free, lapsed, ready].map(async (id) => (await runOf(w, id)).status)), ["DONE", "DONE", "DONE"]);
  // The rest is exactly as it was, down to the lease stamp of the ones that had one.
  assert.deepEqual(await Promise.all(untouched.map((id) => runOf(w, id))), before);
  assert.deepEqual((await itemsOf(w, edge)).map((i) => i.status), ["PENDING"]);
  assert.deepEqual((await itemsOf(w, held)).map((i) => i.status), ["PENDING"]);

  // A second later the lease at the very edge has run out, and it is the only one that has: nothing else is due.
  clock.at = new Date(now + 1_000);
  const again = await callCron(`Bearer ${CRON_SECRET}`);
  assert.deepEqual(await again.json(), { ok: true, resumed: 1 });
  assert.equal(scheduled.length, 1);
});

check("the cron route: a round a runner is working on is not kicked again, and an idle database answers resumed 0", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  if (!(await routeIsSafeToCall(w))) return;
  // Nothing at all to do.
  const idle = await callCron(`Bearer ${CRON_SECRET}`);
  assert.equal(idle.status, 200);
  assert.deepEqual(await idle.json(), { ok: true, resumed: 0 });
  assert.equal(scheduled.length, 0);

  // A real runner, inside its call to Evolution with the lease: the cron comes by and leaves it be.
  await people(w, 3);
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let held = false;
  fake.set("updateParticipant", async (call) => {
    if (!held) {
      held = true;
      await gate;
    }
    return addReply(numberOf(call), "200");
  });
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;
  const runner = runGroupAddRun(runId);
  await until(() => callsTo(fake, "updateParticipant").length >= 1, "the first add");
  const callsBefore = fake.calls.length;
  const during = await callCron(`Bearer ${CRON_SECRET}`);
  assert.deepEqual(await during.json(), { ok: true, resumed: 0 });
  assert.equal(scheduled.length, 0, "the cron kicked a round whose runner holds the lease");
  assert.equal(fake.calls.length, callsBefore);
  assert.notEqual((await runOf(w, runId)).lastDispatchAt, null, "the runner's lease is still stamped");
  open();
  await runner;
  assert.deepEqual(addedNumbers(fake), [N(1), N(2), N(3)], "each person was added once");
  assert.equal((await runOf(w, runId)).status, "DONE");
});

/** A QStash on loopback that says yes to everything it is given and writes down what it got. */
async function listenFakeQstash() {
  const published: { url: string; headers: IncomingHttpHeaders; body: unknown }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      published.push({ url: req.url ?? "", headers: req.headers, body: text ? JSON.parse(text) : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ messageId: "msg-e2e" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    published,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

check("the queue job: it works the round with a budget of 50 s, comes back after the wait it asks for, and is the one the kick publishes", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const handler = JOB_HANDLERS["whatsapp-group-add"];
  assert.ok(handler, "no whatsapp-group-add job in the registry");
  await people(w, 4);
  const runId = await begin(w, { source: { kind: "folder", folderId: null } });
  scheduled.length = 0;

  const qstash = await listenFakeQstash();
  const saved = { token: env.QSTASH_TOKEN, url: env.QSTASH_URL };
  env.QSTASH_TOKEN = "e2e-qstash-token";
  env.QSTASH_URL = qstash.baseUrl;
  try {
    // First visit: 50 s of work (the people at 0 s and 30 s), then the third is due past the budget: asks to come back in 30 s.
    await handler({ runId });
    assert.deepEqual(addedNumbers(fake), [N(1), N(2)]);
    assert.equal(qstash.published.length, 1);
    const [first] = qstash.published;
    assert.ok(first?.url.endsWith("/api/jobs/whatsapp-group-add"), String(first?.url));
    assert.deepEqual(first.body, { runId });
    assert.equal(first.headers["upstash-delay"], "30s");
    assert.equal(first.headers.authorization, "Bearer e2e-qstash-token");
    assert.deepEqual([(await runOf(w, runId)).status, (await runOf(w, runId)).lastDispatchAt], ["RUNNING", null]);

    // The job that comes back goes on from there; it ends when the round does, and then nothing is published.
    let visits = 1;
    while ((await runOf(w, runId)).status === "RUNNING" && visits < 10) {
      await handler({ runId });
      visits++;
    }
    assert.equal((await runOf(w, runId)).status, "DONE");
    assert.deepEqual(addedNumbers(fake), [N(1), N(2), N(3), N(4)], "each person was added once");
    assert.equal(qstash.published.length, visits - 1, "every visit but the last asks to come back");
    for (const sent of qstash.published) {
      assert.deepEqual(sent.body, { runId });
      assert.match(String(sent.headers["upstash-delay"]), /^[1-9]\d*s$/);
    }

    // Nothing to do: no round id, a round that is not there, or one that is over. Nothing is published, nothing is called.
    const published = qstash.published.length;
    const calls = fake.calls.length;
    for (const payload of [null, undefined, {}, { runId: "" }, { runId: null }, { runId: "no-such-run" }, { runId }]) {
      await handler(payload);
    }
    assert.equal(qstash.published.length, published);
    assert.equal(fake.calls.length, calls);

    // The kick, with a queue, publishes this job: the name in the registry is the one the runner publishes under. The start of
    // a round kicks it (nothing else holds the number), and so does a kick of its own.
    qstash.published.length = 0;
    const other = await begin(w, { source: ofContacts([await contactOf(w, { name: "Ana", phone: N(9) })]), group: OTHER_GROUP });
    await kickGroupAddRun(other);
    assert.equal(scheduled.length, 0, "with a queue the kick does not use the process");
    assert.equal(qstash.published.length, 2, "the start and the kick of its own");
    for (const kick of qstash.published) {
      assert.deepEqual(kick.body, { runId: other });
      assert.equal(kick.headers["upstash-delay"], undefined, "a kick is not delayed");
      const job = /\/api\/jobs\/([^/?#]+)$/.exec(kick.url)?.[1];
      assert.equal(job, "whatsapp-group-add");
      assert.ok(job in JOB_HANDLERS);
    }
  } finally {
    env.QSTASH_TOKEN = saved.token;
    env.QSTASH_URL = saved.url;
    await qstash.close();
  }
});

check("another organization sees nothing of a run: no view, no list on the contact, and it can't pause, resume, cancel or poke it", async (ctx) => {
  const { w } = await scenario(ctx);
  const [ana, bia] = [await contactOf(w, { name: "Ana", phone: N(1) }), await contactOf(w, { name: "Bia", phone: FRIEND_NUMBER })];
  const runId = await begin(w, { source: ofContacts([ana, bia]) });
  await drain();

  // The owner sees it all.
  const view = await getGroupAddRunView(w.orgA, runId);
  assert.ok(view);
  assert.deepEqual(
    [view.id, view.groupName, view.status, view.pausedReason, view.waitReason, view.nextAttemptAt, view.createdById],
    [runId, "Ofertas", "DONE", null, null, null, w.userA],
  );
  assert.ok(view.startedAt !== null && view.finishedAt !== null);
  assert.deepEqual(view.counts, { PENDING: 0, PROCESSING: 0, ADDED: 1, INVITED: 0, ALREADY_IN: 1, NO_WHATSAPP: 0, SKIPPED: 0, LEFT_GROUP: 0, ALREADY_INVITED: 0, FAILED: 0 });
  assert.deepEqual(
    view.items.map((i) => [i.contactId, i.contactName, i.status, i.reason, i.processedAt !== null]),
    // Bia was left out before any call (already in the group): no try is stamped on her.
    [[ana, "Ana", "ADDED", null, true], [bia, "Bia", "ALREADY_IN", null, false]],
  );
  const history = await listContactGroupAdds(w.orgA, ana);
  assert.deepEqual(
    history.map((h) => [h.runId, h.groupName, h.status, h.createdById, h.processedAt?.toISOString()]),
    [[runId, "Ofertas", "ADDED", w.userA, "2026-10-28T13:00:00.000Z"]],
  );

  // Org B sees nothing, and changes nothing.
  assert.equal(await getGroupAddRunView(w.orgB, runId), null);
  assert.deepEqual(await listContactGroupAdds(w.orgB, ana), []);
  assert.equal(await getGroupAddRunView(w.orgA, "no-such-run"), null);
  const live = await seedRun(w, { status: "RUNNING", items: [{ name: "x", phone: N(1), status: "PENDING" }] });
  assert.equal(await pauseGroupAdd(w.orgB, live), false);
  assert.equal(await cancelGroupAdd(w.orgB, live), false);
  assert.deepEqual(await resumeGroupAdd(w.orgB, live), { ok: false, error: "not_found" });
  await pokeGroupAdd(w.orgB, live);
  assert.equal(scheduled.length, 0);
  assert.equal((await runOf(w, live)).status, "RUNNING");
});

check("the history of a contact lists the rounds it was in, newest first, and a deleted contact keeps its name in the round", async (ctx) => {
  const { w } = await scenario(ctx);
  const ana = await contactOf(w, { name: "Ana", phone: N(1) });
  const older = await seedRun(w, { createdAt: at("2026-10-20T10:00:00.000Z"), group: OTHER_GROUP, items: [] });
  await w.prisma.whatsappGroupAddItem.create({
    data: { organizationId: w.orgA, runId: older, contactId: ana, contactName: "Ana", position: 0, phone: N(1), phoneKey: phoneMatchKey(N(1)), senderKey: w.owner, status: "FAILED", reason: "http_500", processedAt: at("2026-10-20T10:05:00.000Z") },
  });
  const newer = await begin(w, { source: ofContacts([ana]) });
  await drain();
  const history = await listContactGroupAdds(w.orgA, ana);
  assert.deepEqual(history.map((h) => [h.runId, h.status]), [[newer, "ADDED"], [older, "FAILED"]]);

  await w.prisma.contact.deleteMany({ where: { id: ana } });
  const view = await getGroupAddRunView(w.orgA, newer);
  assert.deepEqual(view?.items.map((i) => [i.contactName, i.status]), [["Ana", "ADDED"]]);
});

check("what the tracking screens read: the pause note in the view, the date and state of the round in the contact's register, and the forecast from what the number spent today", async (ctx) => {
  const { w } = await scenario(ctx);

  // The view carries the note a pause was left with: the screen tells "the group could not be read" from "no longer admin" by it.
  const unreadable = await seedRun(w, { status: "PAUSED", pausedReason: "not_admin", lastError: "group_unreadable", items: [{ name: "Ana", phone: N(1), status: "PENDING" }] });
  const definite = await seedRun(w, { status: "PAUSED", pausedReason: "not_admin", group: OTHER_GROUP, items: [{ name: "Ana", phone: N(1), status: "PENDING" }] });
  assert.deepEqual(
    [(await getGroupAddRunView(w.orgA, unreadable))?.lastError, (await getGroupAddRunView(w.orgA, definite))?.lastError],
    ["group_unreadable", null],
  );

  // The register on the contact says when the round was made (for whoever was left out before any call, who has no try stamped)
  // and in what state it ended up, so a person never reached by a canceled round does not read as "queued".
  const ana = await contactOf(w, { name: "Ana", phone: N(1) });
  const canceled = await seedRun(w, { status: "CANCELED", group: "120363000000000033@g.us", createdAt: at("2026-10-27T10:00:00.000Z"), items: [] });
  await w.prisma.whatsappGroupAddItem.create({
    data: { organizationId: w.orgA, runId: canceled, contactId: ana, contactName: "Ana", position: 0, phone: N(1), phoneKey: phoneMatchKey(N(1)), senderKey: w.owner, status: "PENDING" },
  });
  const history = await listContactGroupAdds(w.orgA, ana);
  assert.deepEqual(
    history.map((h) => [h.runId, h.status, h.processedAt, h.runCreatedAt.toISOString(), h.runStatus]),
    [[canceled, "PENDING", null, "2026-10-27T10:00:00.000Z", "CANCELED"]],
  );
  assert.deepEqual(await listContactGroupAdds(w.orgB, ana), []);

  // The forecast: the review's own simulation for the people still waiting (PENDING and the one being tried), from what the
  // number has already tried today (an ADDED, an INVITED and a FAILED count; a SKIPPED does not).
  const today = at("2026-10-28T11:00:00.000Z");
  const going = await seedRun(w, {
    status: "RUNNING",
    group: "120363000000000044@g.us",
    items: [
      { name: "A", phone: N(11), status: "ADDED", processedAt: today },
      { name: "B", phone: N(12), status: "INVITED", processedAt: today },
      { name: "C", phone: N(13), status: "FAILED", reason: "http_500", processedAt: today },
      { name: "D", phone: N(14), status: "SKIPPED", reason: "opted_out" },
      { name: "E", phone: N(15), status: "PROCESSING", processedAt: today },
      { name: "F", phone: N(16), status: "PENDING" },
      { name: "G", phone: N(17), status: "PENDING" },
    ],
  });
  // 3 waiting (2 PENDING and the PROCESSING one), 3 tried today: 10:00 + 3 minutes.
  assert.equal((await forecastGroupAddRun(w.orgA, going))?.toISOString(), forecastFinish(clock.at, 3, 3).toISOString());
  assert.equal((await forecastGroupAddRun(w.orgA, going))?.toISOString(), "2026-10-28T13:03:00.000Z");
  // The number's whole day goes in, from every round of it: another round that tried 100 people today (the cap) pushes the same
  // 3 people to the next morning at 08:00 (11:00Z), plus their 3 minutes.
  await seedRun(w, {
    status: "DONE",
    group: "120363000000000066@g.us",
    items: Array.from({ length: 100 }, (_, i): SeedItem => ({ name: `T${i}`, phone: N(100 + i), status: "FAILED", reason: "http_500", processedAt: today })),
  });
  assert.equal((await forecastGroupAddRun(w.orgA, going))?.toISOString(), forecastFinish(clock.at, 3, 103).toISOString());
  assert.equal((await forecastGroupAddRun(w.orgA, going))?.toISOString(), "2026-10-29T11:03:00.000Z");

  // Nothing to say for a round that isn't going (paused, queued, finished), one with nobody waiting, or another company's.
  assert.equal(await forecastGroupAddRun(w.orgA, unreadable), null);
  const idle = await seedRun(w, { status: "RUNNING", group: "120363000000000055@g.us", items: [{ name: "A", phone: N(21), status: "ADDED", processedAt: today }] });
  assert.equal(await forecastGroupAddRun(w.orgA, idle), null);
  assert.equal(await forecastGroupAddRun(w.orgA, canceled), null);
  assert.equal(await forecastGroupAddRun(w.orgB, going), null);
  assert.equal(await forecastGroupAddRun(w.orgA, "no-such-run"), null);
});

// ── What reaches the console ─────────────────────────────────────────────────

/** Nothing of a contact or of the invite: the numbers, their last digits, the typed text and the link. */
function assertNoSecrets(lines: string[], secrets: string[]): void {
  for (const line of lines) {
    for (const secret of secrets) {
      // The message says nothing of the line: a failing assertion must not print the number or the text either.
      assert.ok(!line.includes(secret), "a console line holds a number or the invite text");
    }
  }
}

check("logs: an error in the run writes a trace with no number and no invite text, and pauses it with a clean lastError", async (ctx) => {
  const { w } = await scenario(ctx);
  const text = "Oi {{nome}}, segredo-do-convite";
  await people(w, 2);
  const runId = await begin(w, { source: { kind: "folder", folderId: null }, text });
  scheduled.length = 0;
  // An exception that carries the number and the text, as the message of a library's error may.
  const random = groupAddRuntime.random;
  groupAddRuntime.random = () => {
    throw new Error(`boom ${N(1)} segredo-do-convite`);
  };
  let lines: string[];
  try {
    lines = await consoleLinesOf(async () => {
      assert.deepEqual(await runGroupAddRun(runId), { done: true });
    });
  } finally {
    groupAddRuntime.random = random;
  }
  // The control: the failure did leave a line, so an empty list of secrets below means something.
  assert.ok(lines.length >= 1, "the failure left no trace at all");
  assertNoSecrets(lines, [N(1), "911110001", "segredo", "boom", "Pessoa 1"]);

  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.pausedReason, run.lastDispatchAt], ["PAUSED", "error", null]);
  assert.ok(run.lastError, "the pause has no lastError");
  assertNoSecrets([run.lastError], [N(1), "911110001", "segredo", "boom"]);
  // The person tried before the error is settled; the one not reached is untouched.
  assert.deepEqual((await itemsOf(w, runId)).map((i) => i.status), ["ADDED", "PENDING"]);
});

check("logs: Evolution's own errors repeat the number and the text, and none of it reaches the console", async (ctx) => {
  const { fake, w } = await scenario(ctx);
  const text = "Oi {{nome}}, segredo-do-convite";
  const echo = (status: number, call: FakeEvoCall): FakeEvoReply => ({
    status,
    json: {
      status,
      error: "Error",
      response: { message: [`Failed for ${numberOf(call)}: ${String(bodyOf(call).text ?? "")} ${text}`] },
    },
  });
  fake.set("whatsappNumbers", (call) =>
    numberOf(call) === N(3) ? echo(500, call) : { status: 200, json: [{ exists: true, jid: `${numberOf(call)}@s.whatsapp.net`, number: numberOf(call) }] },
  );
  fake.set("updateParticipant", (call) => {
    const number = numberOf(call);
    if (number === N(1)) return addReply(number, "403", PRIVACY); // the invite fails below
    if (number === N(2)) return echo(500, call);
    return addReply(number, "200");
  });
  fake.set("sendText", (call) => echo(500, call));
  const ids = await people(w, 4);
  const runId = await begin(w, { source: ofContacts(ids), text });
  const lines = await consoleLinesOf(async () => {
    await drain();
  });
  assert.deepEqual(await verdicts(w, runId), [
    ["Pessoa 1", "FAILED", "invite_failed"],
    ["Pessoa 2", "FAILED", "http_500"],
    ["Pessoa 3", "ADDED", null],
    ["Pessoa 4", "ADDED", null],
  ]);
  assertNoSecrets(lines, [N(1), N(2), N(3), N(4), "911110001", "segredo", "Failed for", "chat.whatsapp.com", "Pessoa"]);
  const run = await runOf(w, runId);
  assert.deepEqual([run.status, run.lastError], ["DONE", null]);
});

// ── Harness ──────────────────────────────────────────────────────────────────

/** The check creates and deletes organizations: only against the local database, never a shared one. */
function assertLocalDatabase(): void {
  const host = new URL(env.DATABASE_URL).hostname; // never the whole URL: it holds the password
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new Error(
      `check:group-add:e2e creates and deletes test organizations: it only runs against the local Postgres (DATABASE_URL points at ${host}).`,
    );
  }
}

/** What the harness created, so a failure half way through still cleans up. */
const made = { orgs: [] as string[], users: [] as string[] };

async function createWorld(prisma: PrismaClient): Promise<World> {
  const stamp = Date.now();
  const user = async (tag: string) => {
    const created = await prisma.user.create({
      data: { name: `WGA-E2E-${stamp} ${tag}`, email: `wga-${tag}-${stamp}@test.local`, passwordHash: "x" },
      select: { id: true },
    });
    made.users.push(created.id);
    return created.id;
  };
  const [userA, colleague, userB] = [await user("a"), await user("colleague"), await user("b")];
  const org = async (slug: string, name: string, ownerId: string) => {
    const created = await prisma.organization.create({ data: { name, slug, ownerId }, select: { id: true } });
    made.orgs.push(created.id);
    return created.id;
  };
  const orgA = await org(`wga-e2e-${stamp}`, `WGA-E2E-${stamp}`, userA);
  const orgB = await org(`wga-e2e-${stamp}-b`, `WGA-E2E-${stamp}-B`, userB);
  await prisma.membership.createMany({
    data: [
      { organizationId: orgA, userId: userA, role: "OWNER" },
      { organizationId: orgA, userId: colleague, role: "MEMBER" },
      { organizationId: orgB, userId: userB, role: "OWNER" },
    ],
  });
  // Pointing at loopback from the start; each check points them at its own fake.
  const connection = async (organizationId: string, ownerId: string, instance: string) => {
    const baseUrl = "http://127.0.0.1:9";
    assertLoopback(baseUrl);
    const created = await prisma.integrationConnection.create({
      data: {
        organizationId,
        ownerId,
        provider: "EVOLUTION",
        label: `wga-e2e ${instance}`,
        status: "ACTIVE",
        credentialsEnc: encryptCredentials({ baseUrl, apiKey: "e2e", instance }),
      },
      select: { id: true },
    });
    return created.id;
  };
  return {
    prisma,
    // 13 digits, a BR mobile: 55 + 11 + 9 + 8 digits, the last 6 of the stamp making it new on each run.
    owner: `5511988${String(stamp).slice(-6)}`,
    orgA,
    orgB,
    userA,
    colleague,
    userB,
    connA: await connection(orgA, userA, "wga-a"),
    connB: await connection(orgB, userB, "wga-b"),
  };
}

/** Runs and their items, contacts, folders, connections, memberships, users and organizations; whatever was created. */
async function destroyWorld(prisma: PrismaClient): Promise<void> {
  const inTest = { organizationId: { in: made.orgs } };
  await prisma.whatsappGroupAddRun.deleteMany({ where: inTest }); // the items go with it
  await prisma.contact.deleteMany({ where: inTest });
  await prisma.contactFolder.deleteMany({ where: inTest });
  await prisma.integrationConnection.deleteMany({ where: inTest });
  await prisma.membership.deleteMany({ where: inTest });
  await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  await prisma.organization.deleteMany({ where: { id: { in: made.orgs } } });
}

async function main(): Promise<number> {
  assertLocalDatabase();
  // The queue is a real service: with a token in .env a kick would publish to it. The checks run what is scheduled themselves.
  // (The one check of the queue job points the client at a QStash of its own on loopback, and puts this back.)
  env.QSTASH_TOKEN = undefined;
  // The cron route is called with a secret of the checks, whatever .env holds, or does not.
  const realCronSecret = env.CRON_SECRET;
  env.CRON_SECRET = CRON_SECRET;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  const undoFetch = refuseOtherHosts();
  const defaults = { ...groupAddRuntime };
  let passed = 0;
  try {
    // The control of the guard: another host is refused before anything leaves the machine (".invalid" never resolves anyway).
    await assert.rejects(() => fetch("http://evolution.invalid/"), /blocked/);
    assert.deepEqual(refused.splice(0), ["evolution.invalid"]);
    const world = await createWorld(prisma);
    installRuntime();
    for (const c of checks) {
      const started: FakeEvolution[] = [];
      const ctx: Ctx = {
        world,
        startFake: async (instance = "e2e") => {
          const fake = await listenFakeEvolution();
          started.push(fake);
          return { ...fake, creds: { baseUrl: `http://127.0.0.1:${fake.port}`, apiKey: "e2e", instance } };
        },
      };
      try {
        await c.run(ctx);
        assert.deepEqual(refused, [], "a request went to a host that isn't loopback");
      } finally {
        await Promise.all(started.map((fake) => fake.close()));
      }
      passed++;
      console.log(`  ✓ ${c.name}`);
    }
    return passed;
  } finally {
    undoFetch();
    env.CRON_SECRET = realCronSecret;
    Object.assign(groupAddRuntime, defaults);
    await destroyWorld(prisma).catch((e) => console.error("cleanup failed:", e instanceof Error ? e.message : "unknown error"));
    await prisma.$disconnect();
    // The app's own client (the service reads through tenantDb) has a pool of its own.
    await appPrisma.$disconnect();
  }
}

main()
  .then((passed) => console.log(`\ncheck:group-add:e2e — ${passed} checks passed`))
  .catch((e) => {
    console.error("\nGROUP-ADD E2E CHECK FAILED:", e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
    process.exit(1);
  });
