/**
 * Integration check of "Adicionar a grupo do WhatsApp" (spec 2026-10-28): what check:group-add can't reach, the server
 * code that talks to Evolution. It runs against a fake Evolution on loopback (scripts/shims/fake-evolution.ts), so nothing
 * reaches WhatsApp and no number, group or message is real. The server modules (`server-only`, the `@/` alias) load
 * through scripts/tsconfig.server.json.
 *
 * Run: npm run check:group-add:e2e   (needs a valid .env; no database yet and no internet: the fake is on loopback)
 * Exits non-zero on the first failure. Every check starts a fake of its own and it is closed when the check ends.
 *
 * Later tasks add their checks with check(...) above main().
 */
import assert from "node:assert/strict";
import { inspect } from "node:util";
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
import {
  FAKE_EVO_GROUP,
  FAKE_EVO_GROUP_JID,
  FAKE_EVO_OWNER_JID,
  FAKE_EVO_ROUTES,
  listenFakeEvolution,
  type FakeEvolution,
} from "./shims/fake-evolution";

type StartedFake = FakeEvolution & { creds: EvoCreds };

type Ctx = {
  /** A fake Evolution of this check's own, closed when the check ends (pass or fail). `instance` is the name in the credentials. */
  startFake: (instance?: string) => Promise<StartedFake>;
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

// ── Harness ──────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  let passed = 0;
  for (const c of checks) {
    const started: FakeEvolution[] = [];
    const ctx: Ctx = {
      startFake: async (instance = "e2e") => {
        const fake = await listenFakeEvolution();
        started.push(fake);
        return { ...fake, creds: { baseUrl: `http://127.0.0.1:${fake.port}`, apiKey: "e2e", instance } };
      },
    };
    try {
      await c.run(ctx);
    } finally {
      await Promise.all(started.map((fake) => fake.close()));
    }
    passed++;
    console.log(`  ✓ ${c.name}`);
  }
  return passed;
}

main()
  .then((passed) => console.log(`\ncheck:group-add:e2e — ${passed} checks passed`))
  .catch((e) => {
    console.error("\nGROUP-ADD E2E CHECK FAILED:", e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
    process.exit(1);
  });
