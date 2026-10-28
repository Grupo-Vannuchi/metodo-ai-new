/**
 * Self-check for the pure rules of "Adicionar a grupo do WhatsApp" (no DB, no
 * network, no env): the rules in src/lib/whatsapp/group-add/core.ts, how
 * Evolution's answers are read (src/lib/integrations/evolution-groups.ts) and a
 * static guard on what the feature may write to WhatsApp. Run with
 * `npm run check:group-add`; exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  existsOnWhatsapp,
  inviteUrlFrom,
  isAdminOf,
  jidDigits,
  ownerJidFrom,
  parseGroupList,
  participantUpdateCode,
  type EvoGroupSummary,
} from "../src/lib/integrations/evolution-groups";
import {
  CAP_COUNTED,
  capResumeAt,
  countPlan,
  forecastFinish,
  GROUP_ADD_DAILY_CAP,
  GROUP_ADD_FORECAST_SECONDS,
  GROUP_ADD_MAX_CONTACTS,
  GROUP_ADD_PAUSE_SECONDS,
  GROUP_ADD_WINDOW,
  INVITE_TEXT_MAX,
  isInsideWindow,
  nextAttemptAt,
  nextWindowStart,
  outcomeFromCode,
  phoneMatchKey,
  pickPauseSeconds,
  planGroupAdd,
  renderInvite,
  WHATSAPP_GROUP_MAX,
  type CandidateInput,
  type PlannedItem,
  type PreviousOutcome,
} from "../src/lib/whatsapp/group-add/core";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();

function contact(contactId: string, phone: string | null, optedOut = false): CandidateInput {
  return { contactId, name: `Contato ${contactId}`, phone, optedOut };
}
const verdict = (item: PlannedItem) => ({ status: item.status, reason: item.reason });
function keyOf(phone: string): string {
  const key = phoneMatchKey(phone);
  assert.ok(key, `no key for ${phone}`);
  return key;
}

check("the pacing, cap and size constants are the agreed ones", () => {
  assert.equal(GROUP_ADD_DAILY_CAP, 100);
  assert.deepEqual(GROUP_ADD_WINDOW, { startHour: 8, endHour: 20 });
  assert.deepEqual(GROUP_ADD_PAUSE_SECONDS, { min: 30, max: 90 });
  assert.equal(GROUP_ADD_FORECAST_SECONDS, 60);
  assert.equal(WHATSAPP_GROUP_MAX, 1024);
  assert.equal(GROUP_ADD_MAX_CONTACTS, 1000);
  assert.equal(INVITE_TEXT_MAX, 1000);
  // Only people the WhatsApp was actually asked about count against the day.
  assert.deepEqual([...CAP_COUNTED], ["ADDED", "INVITED", "FAILED"]);
});

check("phoneMatchKey gives one key to the same BR mobile in any format", () => {
  const formats = [
    "(11) 98765-4321",
    "5511987654321",
    "+55 11 98765-4321",
    "551187654321", // 12 digits: the old form without the 9
    "(11) 8765-4321", // the same old form, local and masked
  ];
  for (const raw of formats) assert.equal(phoneMatchKey(raw), "11987654321", raw);
  // A foreign number still gets a key (last 11 digits), like in the group import.
  assert.equal(phoneMatchKey("+44 7911 123456"), "47911123456");
});

check("phoneMatchKey is null when there is no usable number", () => {
  for (const raw of [null, undefined, "", "   ", "abc", "12345"]) assert.equal(phoneMatchKey(raw), null, String(raw));
});

check("planGroupAdd: opt-out is skipped even when the number is in the group", () => {
  const plan = planGroupAdd(
    [contact("c1", "(11) 98765-4321", true), contact("c2", null, true)],
    new Set(["11987654321"]),
    [],
  );
  assert.deepEqual(plan.map(verdict), [
    { status: "SKIPPED", reason: "opted_out" },
    { status: "SKIPPED", reason: "opted_out" }, // opt-out outranks having no phone
  ]);
});

check("planGroupAdd: an opt-out blocks every record of the same number, the opted-out one first", () => {
  const plan = planGroupAdd(
    [
      contact("c1", "(11) 98765-4321", true),
      contact("c2", "5511987654321"),
      contact("c3", "(11) 8765-4321"), // the older 8-digit form of the same number
      contact("c4", "(11) 91111-2222"), // someone else
    ],
    new Set(["11987654321"]), // the number is even in the group: the opt-out still comes first
    [],
  );
  assert.deepEqual(plan.map(verdict), [
    { status: "SKIPPED", reason: "opted_out" },
    { status: "SKIPPED", reason: "opted_out" },
    { status: "SKIPPED", reason: "opted_out" },
    { status: "PENDING", reason: null },
  ]);
});

check("planGroupAdd: an opt-out blocks every record of the same number, the opted-out one last", () => {
  const plan = planGroupAdd(
    [
      contact("c1", "5511987654321"),
      contact("c2", "(11) 91111-2222"), // someone else
      contact("c3", "+55 11 98765-4321"),
      contact("c4", "(11) 98765-4321", true),
    ],
    new Set(),
    [],
  );
  assert.deepEqual(plan.map(verdict), [
    { status: "SKIPPED", reason: "opted_out" },
    { status: "PENDING", reason: null },
    { status: "SKIPPED", reason: "opted_out" },
    { status: "SKIPPED", reason: "opted_out" },
  ]);
});

check("planGroupAdd: an opt-out with no usable number blocks nobody else", () => {
  const plan = planGroupAdd(
    [
      contact("c1", null, true), // opted out, no phone
      contact("c2", null), // no phone: not touched by c1
      contact("c3", "12345", true), // opted out, digits that make no number
      contact("c4", "12345"), // same digits: still just not a mobile
    ],
    new Set(),
    [],
  );
  assert.deepEqual(plan.map(verdict), [
    { status: "SKIPPED", reason: "opted_out" },
    { status: "SKIPPED", reason: "no_phone" },
    { status: "SKIPPED", reason: "opted_out" },
    { status: "NO_WHATSAPP", reason: "not_mobile" },
  ]);
});

check("planGroupAdd: no phone is skipped as no_phone", () => {
  // A phone field with no digits at all (a dash, a note) counts as empty.
  const blanks = [contact("c1", null), contact("c2", ""), contact("c3", "   "), contact("c4", "-")];
  const plan = planGroupAdd(blanks, new Set(), []);
  for (const item of plan) assert.deepEqual(verdict(item), { status: "SKIPPED", reason: "no_phone" });
  assert.deepEqual(
    plan.map((i) => i.phoneKey),
    [null, null, null, null],
  );
});

check("planGroupAdd: a landline or a malformed number is NO_WHATSAPP / not_mobile", () => {
  // Even when the landline's key is (wrongly) among the participants: not a mobile comes first.
  const plan = planGroupAdd([contact("c1", "(11) 3333-4444"), contact("c2", "12345")], new Set(["1133334444"]), []);
  assert.deepEqual(plan.map(verdict), [
    { status: "NO_WHATSAPP", reason: "not_mobile" },
    { status: "NO_WHATSAPP", reason: "not_mobile" },
  ]);
  assert.deepEqual(
    plan.map((i) => i.phoneKey),
    ["1133334444", null],
  );
});

check("planGroupAdd: the older 8-digit mobile is a mobile, dialed with the 9", () => {
  const [pending] = planGroupAdd([contact("c1", "(11) 8765-4321")], new Set(), []);
  assert.deepEqual(verdict(pending), { status: "PENDING", reason: null });
  assert.equal(pending.phone, "5511987654321");
  assert.equal(pending.phoneKey, "11987654321");
  // The same number when it is in the group, whichever form the group lists it in.
  for (const listed of ["5511987654321", "551187654321"]) {
    const [inGroup] = planGroupAdd([contact("c1", "(11) 8765-4321")], new Set([keyOf(listed)]), []);
    assert.deepEqual(verdict(inGroup), { status: "ALREADY_IN", reason: null });
  }
  // A landline (it starts with 2 to 5) gets no 9 and is still not a mobile.
  const [landline] = planGroupAdd([contact("c2", "(11) 3333-4444")], new Set(), []);
  assert.deepEqual(verdict(landline), { status: "NO_WHATSAPP", reason: "not_mobile" });
  assert.equal(landline.phone, "551133334444");
});

check("planGroupAdd: phone is the number to dial when there is one, the typed value otherwise", () => {
  const typed = ["(11) 98765-4321", "+55 11 98765-4321", "(11) 3333-4444", "+44 7911 123456", "12345", "-", "", null];
  const plan = planGroupAdd(
    typed.map((phone, i) => contact(`c${i}`, phone)),
    new Set(),
    [],
  );
  assert.deepEqual(
    plan.map((i) => i.phone),
    ["5511987654321", "5511987654321", "551133334444", "447911123456", "12345", "-", "", null],
  );
});

check("planGroupAdd: someone in the group is ALREADY_IN, whatever the format on each side", () => {
  // The group lists the old 12-digit form; the CRM has the 9 and a mask.
  const inGroup = new Set([keyOf("551187654321"), keyOf("5511999990000")]);
  const plan = planGroupAdd([contact("c1", "(11) 98765-4321"), contact("c2", "(11) 91111-2222")], inGroup, []);
  assert.deepEqual(plan.map(verdict), [
    { status: "ALREADY_IN", reason: null },
    { status: "PENDING", reason: null },
  ]);
});

check("planGroupAdd: ADDED before and gone from the group is LEFT_GROUP, and never added again", () => {
  const previous: PreviousOutcome[] = [{ phoneKey: "11987654321", status: "ADDED" }];
  const [item] = planGroupAdd([contact("c1", "5511987654321")], new Set(), previous);
  assert.deepEqual(verdict(item), { status: "LEFT_GROUP", reason: null });
});

check("planGroupAdd: INVITED before and not in the group is ALREADY_INVITED", () => {
  const previous: PreviousOutcome[] = [{ phoneKey: "11987654321", status: "INVITED" }];
  const [item] = planGroupAdd([contact("c1", "(11) 98765-4321")], new Set(), previous);
  assert.deepEqual(verdict(item), { status: "ALREADY_INVITED", reason: null });
});

check("planGroupAdd: INVITED or ADDED before and in the group today is ALREADY_IN", () => {
  const previous: PreviousOutcome[] = [
    { phoneKey: "11987654321", status: "INVITED" },
    { phoneKey: "11911112222", status: "ADDED" },
  ];
  const inGroup = new Set(["11987654321", "11911112222"]);
  const plan = planGroupAdd([contact("c1", "(11) 98765-4321"), contact("c2", "(11) 91111-2222")], inGroup, previous);
  assert.deepEqual(plan.map(verdict), [
    { status: "ALREADY_IN", reason: null },
    { status: "ALREADY_IN", reason: null },
  ]);
});

check("planGroupAdd: ADDED outranks INVITED when both are recorded for the number", () => {
  const previous: PreviousOutcome[] = [
    { phoneKey: "11987654321", status: "INVITED" },
    { phoneKey: "11987654321", status: "ADDED" },
  ];
  const [item] = planGroupAdd([contact("c1", "(11) 98765-4321")], new Set(), previous);
  assert.deepEqual(verdict(item), { status: "LEFT_GROUP", reason: null });
});

check("planGroupAdd: a second contact with the same number is a duplicate, whatever the format", () => {
  const plan = planGroupAdd(
    [contact("c1", "(11) 98765-4321"), contact("c2", "+55 11 98765-4321"), contact("c3", "5511987654321")],
    new Set(),
    [],
  );
  assert.deepEqual(plan.map(verdict), [
    { status: "PENDING", reason: null },
    { status: "SKIPPED", reason: "duplicate" },
    { status: "SKIPPED", reason: "duplicate" },
  ]);
});

check("planGroupAdd: the group and earlier rounds outrank duplicates", () => {
  const twins = [contact("c1", "(11) 98765-4321"), contact("c2", "5511987654321")];
  const inGroup = planGroupAdd(twins, new Set(["11987654321"]), []);
  assert.deepEqual(inGroup.map(verdict), [
    { status: "ALREADY_IN", reason: null },
    { status: "ALREADY_IN", reason: null },
  ]);
  const left = planGroupAdd(twins, new Set(), [{ phoneKey: "11987654321", status: "ADDED" }]);
  assert.deepEqual(left.map(verdict), [
    { status: "LEFT_GROUP", reason: null },
    { status: "LEFT_GROUP", reason: null },
  ]);
});

check("planGroupAdd: everyone else is PENDING, foreign mobiles included", () => {
  const plan = planGroupAdd([contact("c1", "(11) 98765-4321"), contact("c2", "+44 7911 123456")], new Set(), []);
  assert.deepEqual(plan.map(verdict), [
    { status: "PENDING", reason: null },
    { status: "PENDING", reason: null },
  ]);
});

// One folder with every rule in it, in the order the rules are listed.
const folder = [
  contact("c01", "(11) 98765-4321", true), // opt-out, and in the group
  contact("c02", null), // no phone
  contact("c03", "(11) 3333-4444"), // landline
  contact("c04", "(11) 99999-0001"), // in the group
  contact("c05", "(11) 99999-0002"), // ADDED before, gone from the group
  contact("c06", "(11) 99999-0003"), // INVITED before, not in the group
  contact("c07", "(11) 99999-0004"), // INVITED before, in the group today
  contact("c08", "(11) 99999-0005"), // new
  contact("c09", "+55 11 99999-0005"), // same number as c08
  contact("c10", "(11) 99999-0006"), // new
];
const folderGroup = new Set(["11987654321", "11999990001", "11999990004"]);
const folderPrevious: PreviousOutcome[] = [
  { phoneKey: "11999990002", status: "ADDED" },
  { phoneKey: "11999990003", status: "INVITED" },
  { phoneKey: "11999990004", status: "INVITED" },
];

check("planGroupAdd keeps the input order and the shape of each item", () => {
  const plan = planGroupAdd(folder, folderGroup, folderPrevious);
  assert.deepEqual(
    plan.map((i) => i.contactId),
    folder.map((c) => c.contactId),
  );
  assert.deepEqual(plan.map(verdict), [
    { status: "SKIPPED", reason: "opted_out" },
    { status: "SKIPPED", reason: "no_phone" },
    { status: "NO_WHATSAPP", reason: "not_mobile" },
    { status: "ALREADY_IN", reason: null },
    { status: "LEFT_GROUP", reason: null },
    { status: "ALREADY_INVITED", reason: null },
    { status: "ALREADY_IN", reason: null },
    { status: "PENDING", reason: null },
    { status: "SKIPPED", reason: "duplicate" },
    { status: "PENDING", reason: null },
  ]);
  assert.deepEqual(plan[3], {
    contactId: "c04",
    name: "Contato c04",
    phone: "5511999990001", // the number to dial, not the typed "(11) 99999-0001"
    phoneKey: "11999990001",
    status: "ALREADY_IN",
    reason: null,
  });
});

check("countPlan adds up the plan of that folder", () => {
  assert.deepEqual(countPlan(planGroupAdd(folder, folderGroup, folderPrevious)), {
    total: 10,
    pending: 2,
    alreadyIn: 2,
    noWhatsapp: 1,
    skipped: 3,
    leftGroup: 1,
    alreadyInvited: 1,
  });
});

check("countPlan counts other statuses only in the total", () => {
  assert.deepEqual(countPlan([]), {
    total: 0,
    pending: 0,
    alreadyIn: 0,
    noWhatsapp: 0,
    skipped: 0,
    leftGroup: 0,
    alreadyInvited: 0,
  });
  const running = [{ status: "PENDING" }, { status: "PROCESSING" }, { status: "ADDED" }, { status: "FAILED" }] as const;
  assert.deepEqual(countPlan(running), {
    total: 4,
    pending: 1,
    alreadyIn: 0,
    noWhatsapp: 0,
    skipped: 0,
    leftGroup: 0,
    alreadyInvited: 0,
  });
});

check("outcomeFromCode: 200 added, 403 needs the invite, 409 already in, anything else failed", () => {
  assert.equal(outcomeFromCode("200"), "ADDED");
  assert.equal(outcomeFromCode("403"), "NEEDS_INVITE");
  assert.equal(outcomeFromCode("409"), "ALREADY_IN");
  for (const code of ["408", "500", "", "abc", null]) assert.equal(outcomeFromCode(code), "FAILED", String(code));
});

check("isInsideWindow is 08:00 to 19:59:59 in São Paulo", () => {
  assert.equal(isInsideWindow(at("2026-10-28T10:59:59Z")), false); // 07:59:59
  assert.equal(isInsideWindow(at("2026-10-28T11:00:00Z")), true); // 08:00:00
  assert.equal(isInsideWindow(at("2026-10-28T15:30:00Z")), true); // 12:30:00
  assert.equal(isInsideWindow(at("2026-10-28T22:59:59Z")), true); // 19:59:59
  assert.equal(isInsideWindow(at("2026-10-28T23:00:00Z")), false); // 20:00:00
  assert.equal(isInsideWindow(at("2026-10-29T02:00:00Z")), false); // 23:00 of Oct 28, already Oct 29 in UTC
  assert.equal(isInsideWindow(at("2026-10-28T03:00:00Z")), false); // São Paulo midnight
});

check("nextWindowStart is 08:00 São Paulo: today when it is early, tomorrow when it is late", () => {
  assert.equal(iso(nextWindowStart(at("2026-10-28T23:30:00Z"))), "2026-10-29T11:00:00.000Z");
  assert.equal(iso(nextWindowStart(at("2026-10-28T08:00:00Z"))), "2026-10-28T11:00:00.000Z");
  // 23:30 in São Paulo is already Oct 29 in UTC; the next window is still the next São Paulo morning.
  assert.equal(iso(nextWindowStart(at("2026-10-29T02:30:00Z"))), "2026-10-29T11:00:00.000Z");
});

check("nextWindowStart keeps an instant that is already inside the window", () => {
  for (const when of ["2026-10-28T11:00:00Z", "2026-10-28T15:30:15Z", "2026-10-28T22:59:59Z"]) {
    assert.equal(iso(nextWindowStart(at(when))), iso(at(when)));
  }
});

check("nextAttemptAt adds the pause, and waits for the next morning when it ends after 20:00", () => {
  assert.equal(iso(nextAttemptAt(at("2026-10-28T22:59:30Z"), 60)), "2026-10-29T11:00:00.000Z");
  assert.equal(iso(nextAttemptAt(at("2026-10-28T12:00:00Z"), 45)), "2026-10-28T12:00:45.000Z");
  // A pause that ends exactly at 20:00 is already outside the window.
  assert.equal(iso(nextAttemptAt(at("2026-10-28T22:59:00Z"), 60)), "2026-10-29T11:00:00.000Z");
  // A pause that ends before 08:00 waits for 08:00.
  assert.equal(iso(nextAttemptAt(at("2026-10-28T08:00:00Z"), 30)), "2026-10-28T11:00:00.000Z");
});

check("capResumeAt is 08:00 of the next São Paulo day", () => {
  assert.equal(iso(capResumeAt(at("2026-10-28T12:00:00Z"))), "2026-10-29T11:00:00.000Z");
  // 23:00 of Oct 28 in São Paulo is Oct 29 in UTC: the next São Paulo day is still Oct 29.
  assert.equal(iso(capResumeAt(at("2026-10-29T02:00:00Z"))), "2026-10-29T11:00:00.000Z");
});

check("pickPauseSeconds spans 30 to 90 s, always in whole seconds", () => {
  assert.equal(pickPauseSeconds(() => 0), 30);
  assert.equal(pickPauseSeconds(() => 0.999999), 90);
  const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) {
    const seconds = pickPauseSeconds(() => i / 1000);
    assert.ok(Number.isInteger(seconds) && seconds >= 30 && seconds <= 90, `out of range: ${seconds}`);
    seen.add(seconds);
  }
  assert.equal(seen.size, 61); // every second from 30 to 90 can be picked
});

const INVITE_URL = "https://chat.whatsapp.com/AbC";
const INVITE_VARS = { nome: "Ana", grupo: "Ofertas" };

check("renderInvite fills {{nome}} and {{grupo}} and puts the link alone on the last line", () => {
  assert.equal(
    renderInvite("Oi {{nome}}! Este é o link para entrar no grupo {{grupo}}:", INVITE_VARS, INVITE_URL),
    "Oi Ana! Este é o link para entrar no grupo Ofertas:\n\nhttps://chat.whatsapp.com/AbC",
  );
});

check("renderInvite does not repeat a link the text already ends with", () => {
  assert.equal(
    renderInvite("Entre aqui: https://chat.whatsapp.com/AbC", INVITE_VARS, INVITE_URL),
    "Entre aqui: https://chat.whatsapp.com/AbC",
  );
  assert.equal(
    renderInvite("Oi!\n\nhttps://chat.whatsapp.com/AbC\n", INVITE_VARS, INVITE_URL),
    "Oi!\n\nhttps://chat.whatsapp.com/AbC",
  );
  // A link in the middle, or another group's link at the end, is not the closing link.
  assert.equal(
    renderInvite("Veja https://chat.whatsapp.com/AbC e entre", INVITE_VARS, INVITE_URL),
    "Veja https://chat.whatsapp.com/AbC e entre\n\nhttps://chat.whatsapp.com/AbC",
  );
  assert.equal(
    renderInvite("Entre: https://chat.whatsapp.com/Outro", INVITE_VARS, INVITE_URL),
    "Entre: https://chat.whatsapp.com/Outro\n\nhttps://chat.whatsapp.com/AbC",
  );
});

check("renderInvite replaces placeholders with spaces or capitals, and inserts values as typed", () => {
  assert.equal(
    renderInvite("{{ nome }} / {{NOME}} / {{ grupo}}", INVITE_VARS, INVITE_URL),
    "Ana / Ana / Ofertas\n\nhttps://chat.whatsapp.com/AbC",
  );
  // No "$&" replacement patterns, and no second pass over a value that looks like a placeholder.
  assert.equal(
    renderInvite("Oi {{nome}}", { nome: "Ana $& {{grupo}}", grupo: "Ofertas" }, INVITE_URL),
    "Oi Ana $& {{grupo}}\n\nhttps://chat.whatsapp.com/AbC",
  );
});

check("renderInvite with an empty text sends just the link, and refuses to build an invite without one", () => {
  assert.equal(renderInvite("  \n", INVITE_VARS, INVITE_URL), INVITE_URL);
  assert.throws(() => renderInvite("Oi {{nome}}", INVITE_VARS, ""), /link/);
  assert.throws(() => renderInvite("Oi {{nome}}", INVITE_VARS, "   "), /link/);
});

check("forecastFinish: 60 s per person from now when the day has room", () => {
  assert.equal(iso(forecastFinish(at("2026-10-28T12:00:00Z"), 50, 0)), "2026-10-28T12:50:00.000Z");
});

check("forecastFinish: the cap of the day sends the rest to 08:00 of the next day", () => {
  // 20 more fit today (80 used), then 30 on Oct 29 from 11:00Z.
  assert.equal(iso(forecastFinish(at("2026-10-28T12:00:00Z"), 50, 80)), "2026-10-29T11:30:00.000Z");
  // Already at the cap: everyone waits for tomorrow.
  assert.equal(iso(forecastFinish(at("2026-10-28T12:00:00Z"), 3, 100)), "2026-10-29T11:03:00.000Z");
});

check("forecastFinish: the window closing at 20:00 sends the rest to 08:00 of the next day", () => {
  // 19:30 in São Paulo: 30 fit before 20:00, the other 20 start at 11:00Z the next day.
  assert.equal(iso(forecastFinish(at("2026-10-28T22:30:00Z"), 50, 0)), "2026-10-29T11:20:00.000Z");
  // 05:00 in São Paulo: the first one waits for 08:00.
  assert.equal(iso(forecastFinish(at("2026-10-28T08:00:00Z"), 10, 0)), "2026-10-28T11:10:00.000Z");
});

check("forecastFinish: the count starts over on each São Paulo day", () => {
  // 100 a day: Oct 28 from 12:00Z, Oct 29 from 11:00Z, then the last 50 on Oct 30.
  assert.equal(iso(forecastFinish(at("2026-10-28T12:00:00Z"), 250, 0)), "2026-10-30T11:50:00.000Z");
  // 50 used at 19:50: 10 fit before 20:00 (60 used), then a fresh day takes 100 and Oct 30 the last 10.
  assert.equal(iso(forecastFinish(at("2026-10-28T22:50:00Z"), 120, 50)), "2026-10-30T11:10:00.000Z");
});

check("forecastFinish with nobody left is now", () => {
  const now = at("2026-10-28T12:00:00Z");
  assert.equal(iso(forecastFinish(now, 0, 0)), iso(now));
  assert.equal(iso(forecastFinish(now, 0, 100)), iso(now));
});

// ── How Evolution's answers are read (evolution-groups.ts) ───────────────────

const GROUP_JID = "120363000000000001@g.us";

/** `GET /group/fetchAllGroups` of Evolution v2: a group of 3 (one member is a LID with no number) and a chat that is not a group. */
const GROUPS_V2 = [
  {
    id: GROUP_JID,
    subject: "Ofertas",
    size: 3,
    announce: true,
    participants: [
      { id: "5511987654321@s.whatsapp.net", admin: "superadmin" },
      { id: "1@lid", phoneNumber: "5511912345678@s.whatsapp.net", admin: null },
      { id: "2@lid", admin: null },
    ],
  },
  { id: "x@s.whatsapp.net" },
];

function sampleGroup(): EvoGroupSummary {
  const [group] = parseGroupList(GROUPS_V2);
  assert.ok(group, "the sample group was not parsed");
  return group;
}

check("parseGroupList keeps the groups, resolves @lid members through phoneNumber and counts the ones it can't", () => {
  assert.deepEqual(parseGroupList(GROUPS_V2), [
    {
      jid: GROUP_JID,
      subject: "Ofertas",
      size: 3,
      announce: true,
      participants: [
        { number: "5511987654321", admin: true },
        { number: "5511912345678", admin: false },
      ],
      unresolved: 1,
    },
  ]);
});

check("parseGroupList takes { groups: [...] } as well, and gives [] for an answer that is not a list of groups", () => {
  assert.deepEqual(parseGroupList({ groups: GROUPS_V2 }), parseGroupList(GROUPS_V2));
  const notGroups: unknown[] = [
    undefined,
    null,
    "x",
    3,
    {},
    { groups: "x" },
    [null, "x", 3, [], {}, { id: 5 }, { id: "@g.us" }, { id: "1@lid" }, { id: "5511987654321@s.whatsapp.net" }],
  ];
  for (const data of notGroups) assert.deepEqual(parseGroupList(data), [], JSON.stringify(data));
});

check("parseGroupList fills in what the group doesn't say, and reads subject, size and announce only as the right type", () => {
  assert.deepEqual(parseGroupList([{ id: GROUP_JID }]), [
    { jid: GROUP_JID, subject: "", size: 0, announce: null, participants: [], unresolved: 0 },
  ]);
  const [odd] = parseGroupList([
    {
      id: GROUP_JID,
      subject: "  Ofertas  ",
      size: "3",
      announce: "yes",
      participants: [{ id: "5511987654321@s.whatsapp.net" }, null, "x"],
    },
  ]);
  // A size that is not a number is unknown (the members listed stand in for it), and so is an announce that is not a boolean.
  assert.deepEqual(odd, {
    jid: GROUP_JID,
    subject: "Ofertas",
    size: 3,
    announce: null,
    participants: [{ number: "5511987654321", admin: false }],
    unresolved: 2,
  });
  assert.equal(parseGroupList([{ id: GROUP_JID, announce: false }])[0]?.announce, false);
});

check("isAdminOf: true for an admin, false for a member, null when the number could be a member it couldn't read", () => {
  const group = sampleGroup();
  assert.equal(isAdminOf(group, "5511987654321"), true); // the superadmin
  assert.equal(isAdminOf(group, "5511912345678"), false); // listed and not an admin: the answer holds with 1 member unread
  assert.equal(isAdminOf(group, "5511900000000"), null); // not listed, and 1 member has no number: it may be that one
  assert.equal(isAdminOf({ ...group, unresolved: 0 }, "5511900000000"), false); // everybody has a number: not in the group
});

check("isAdminOf: a plain admin counts, and a number of our own that is unknown is never an answer", () => {
  const group = { participants: [{ number: "5511900000000", admin: true }], unresolved: 0 };
  assert.equal(isAdminOf(group, "5511900000000"), true);
  // No digits (a @lid owner, no owner at all): can't be placed, whatever the list says.
  assert.equal(isAdminOf(group, ""), null);
  assert.equal(isAdminOf({ participants: [], unresolved: 0 }, ""), null);
  // The owner JID of an instance carries ":device"; its digits are still the member's number.
  assert.equal(isAdminOf(sampleGroup(), jidDigits("5511987654321:12@s.whatsapp.net")), true);
  assert.equal(isAdminOf(sampleGroup(), jidDigits("123456789012345@lid")), null);
});

check("jidDigits keeps the digits of a phone JID, without the device or the domain, and nothing for any other JID", () => {
  assert.equal(jidDigits("5511987654321:12@s.whatsapp.net"), "5511987654321");
  assert.equal(jidDigits("5511987654321@s.whatsapp.net"), "5511987654321");
  assert.equal(jidDigits("5511987654321@c.us"), "5511987654321");
  assert.equal(jidDigits("5511987654321"), "5511987654321");
  for (const jid of ["123456789012345@lid", "123456789012345:3@lid", GROUP_JID, "abc@s.whatsapp.net", "@s.whatsapp.net", ""]) {
    assert.equal(jidDigits(jid), "", jid);
  }
});

check("ownerJidFrom reads the JID of the instance's own number from the v2 and the v1 answer, and only for that instance", () => {
  const jid = "5511987654321@s.whatsapp.net";
  const other = "5511911112222@s.whatsapp.net";
  const v2 = [{ name: "inst", ownerJid: jid }];
  const v1 = [{ instance: { instanceName: "inst", owner: jid } }];
  assert.equal(ownerJidFrom(v2, "inst"), jid);
  assert.equal(ownerJidFrom(v1, "inst"), jid);
  // Another instance's number is never ours.
  assert.equal(ownerJidFrom(v2, "other"), null);
  assert.equal(ownerJidFrom(v1, "other"), null);
  // An answer that lists several instances: the one asked for.
  assert.equal(ownerJidFrom([{ name: "other", ownerJid: other }, ...v2], "inst"), jid);
  assert.equal(ownerJidFrom([{ instance: { instanceName: "other", owner: other } }, ...v1], "inst"), jid);
  // An instance that isn't linked to a number has no owner, and anything else is not an answer.
  const noOwner: unknown[] = [
    [{ name: "inst", ownerJid: null }],
    [{ name: "inst", ownerJid: "  " }],
    [{ name: "inst" }],
    [{ instance: { instanceName: "inst" } }],
    [],
    {},
    null,
    undefined,
    "x",
  ];
  for (const data of noOwner) assert.equal(ownerJidFrom(data, "inst"), null, JSON.stringify(data));
});

check("participantUpdateCode reads the status of the first update, as text", () => {
  assert.equal(participantUpdateCode({ updateParticipants: [{ status: "403" }] }), "403");
  assert.equal(participantUpdateCode({ updateParticipants: [{ status: 200 }] }), "200");
  // The answer for a number whose privacy settings ask for the link.
  const privacy = {
    updateParticipants: [
      {
        status: "403",
        jid: "5511987654321@s.whatsapp.net",
        content: { tag: "add_request", attrs: { code: "XyZ", expiration: "1700000000" } },
      },
    ],
  };
  assert.equal(participantUpdateCode(privacy), "403");
  // One person per call, so there is one update; if more ever come, the first is the one.
  assert.equal(participantUpdateCode({ updateParticipants: [{ status: "403" }, { status: "200" }] }), "403");
  const noCode: unknown[] = [
    {},
    null,
    undefined,
    "x",
    [],
    [{ status: "200" }],
    { updateParticipants: [] },
    { updateParticipants: "x" },
    { updateParticipants: [null] },
    { updateParticipants: [{}] },
    { updateParticipants: [{ status: null }] },
    { updateParticipants: [{ status: "" }] },
    { updateParticipants: [{ status: {} }] },
  ];
  for (const data of noCode) assert.equal(participantUpdateCode(data), null, JSON.stringify(data));
});

check("existsOnWhatsapp reads the first answer of whatsappNumbers", () => {
  assert.equal(existsOnWhatsapp([{ exists: false }]), false);
  assert.equal(existsOnWhatsapp([{ exists: true, jid: "5511987654321@s.whatsapp.net", number: "5511987654321" }]), true);
  const noAnswer: unknown[] = [{}, null, undefined, [], [null], [{}], [{ exists: "true" }], [{ exists: 1 }], { exists: true }];
  for (const data of noAnswer) assert.equal(existsOnWhatsapp(data), null, JSON.stringify(data));
});

check("inviteUrlFrom accepts only a https://chat.whatsapp.com/ link, and builds it from the code", () => {
  assert.equal(inviteUrlFrom({ inviteUrl: "https://chat.whatsapp.com/AbC" }), "https://chat.whatsapp.com/AbC");
  assert.equal(inviteUrlFrom({ inviteCode: "AbC" }), "https://chat.whatsapp.com/AbC");
  // What Evolution sends: both, agreeing.
  assert.equal(inviteUrlFrom({ inviteUrl: "https://chat.whatsapp.com/AbC", inviteCode: "AbC" }), "https://chat.whatsapp.com/AbC");
  assert.equal(inviteUrlFrom({ inviteUrl: "http://evil.example/x" }), null);
  const notOurs = [
    "http://chat.whatsapp.com/AbC",
    "https://chat.whatsapp.com/",
    "https://chat.whatsapp.com",
    "https://chat.whatsapp.com.evil.example/AbC",
    "https://evil.example/https://chat.whatsapp.com/AbC",
    "https://chat.whatsapp.com/AbC extra",
    "https://chat.whatsapp.com/AbC\nhttp://evil.example/x",
    "javascript:alert(1)",
    "AbC",
  ];
  for (const inviteUrl of notOurs) assert.equal(inviteUrlFrom({ inviteUrl }), null, inviteUrl);
  // A link that is not ours is not rescued by the code beside it.
  assert.equal(inviteUrlFrom({ inviteUrl: "http://evil.example/x", inviteCode: "AbC" }), null);
  for (const inviteCode of ["", "  ", "A b", "AbC/../x", "AbC?x=1", 5, null]) {
    assert.equal(inviteUrlFrom({ inviteCode }), null, String(inviteCode));
  }
  const noLink: unknown[] = [{}, null, undefined, "x", [], [{ inviteCode: "AbC" }]];
  for (const data of noLink) assert.equal(inviteUrlFrom(data), null, JSON.stringify(data));
});

// ── What the feature may write to WhatsApp ───────────────────────────────────
//
// Two writes only: add one participant and send the invite text. The link goes out with the text, one person at a time, so
// the call that sends it to a whole list at once is out, and so is any other action on the group or on its settings.

/** Every .ts file under `dir`, recursively. A folder that isn't there throws: a scan that finds nothing must not pass. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

type Rule = { rule: string; re: RegExp; trips: string[] };

const NO_SEND_INVITE: Rule = {
  rule: "name sendInvite",
  re: /sendInvite/i,
  trips: ["POST /group/sendInvite/e2e", "evo.sendInvite(1)", "// not sendinvite"],
};
const NO_UPDATE_SETTING: Rule = {
  rule: "name updateSetting",
  re: /updateSetting/i,
  trips: ["POST /group/updateSetting/e2e", "// no updatesetting"],
};
const NO_MEMBER_ACTION_STRING: Rule = {
  rule: 'write "remove", "promote" or "demote" as a string',
  re: /["'`](?:remove|promote|demote)["'`]/,
  trips: ['action: "remove"', "action: 'promote'", "const A = `demote`", '["add", "remove"]'],
};
const NO_MEMBER_ACTION_FIELD: Rule = {
  rule: 'send action: "remove", "promote" or "demote"',
  re: /\baction["']?\s*:\s*["'`](?:remove|promote|demote)["'`]/,
  trips: ['{ action: "remove", participants: [number] }', "{action:'promote'}", "action : `demote`", '{ "action": "remove" }'],
};
/** What the code is allowed to say, so a rule can't be loosened into tripping on it. */
const ALLOWED_CODE = [
  '{ action: "add", participants: [number] }',
  "// remove the item from the plan",
  "const removed = items.filter(Boolean)",
  "participants: [number]",
  "await sendPlainText(creds, number, text)",
];

/** The patterns themselves, so a typo in one can't turn a scan below into a silent pass. */
function assertRulesWork(rules: Rule[]): void {
  for (const { rule, re, trips } of rules) {
    for (const sample of trips) assert.ok(re.test(sample), `${rule}: ${sample}`);
  }
  for (const sample of ALLOWED_CODE) {
    for (const { rule, re } of rules) assert.ok(!re.test(sample), `${rule} wrongly trips on ${sample}`);
  }
}

check("nothing in group-add/ names sendInvite or updateSetting, or writes remove, promote or demote (comments included)", () => {
  const rules = [NO_SEND_INVITE, NO_UPDATE_SETTING, NO_MEMBER_ACTION_STRING];
  assertRulesWork(rules);
  const dir = join(__dirname, "..", "src", "lib", "whatsapp", "group-add");
  const files = sourcesUnder(dir);
  // Not a silent pass: the module this folder is known to hold has to be among the files read.
  const read = files.map((file) => relative(dir, file));
  assert.ok(read.includes("core.ts"), `core.ts was not read (read: ${read.join(", ") || "nothing"})`);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const { rule, re } of rules) assert.ok(!re.test(text), `${relative(dir, file)} must not ${rule}`);
  }
});

check("the Evolution client sends no member action but add, and never names sendInvite or updateSetting", () => {
  const rules = [NO_SEND_INVITE, NO_UPDATE_SETTING, NO_MEMBER_ACTION_FIELD];
  assertRulesWork(rules);
  const text = readFileSync(join(__dirname, "..", "src", "lib", "integrations", "evolution-client.ts"), "utf8");
  // It has to be the file with the group calls, or this scan proves nothing. (Not assert.match: its message would print the file.)
  assert.ok(/\/group\/updateParticipant\//.test(text), "evolution-client.ts has no add call to scan");
  assert.ok(/\baction: "add"/.test(text), "evolution-client.ts does not send action add");
  for (const { rule, re } of rules) assert.ok(!re.test(text), `evolution-client.ts must not ${rule}`);
});

console.log(`\n✅ group-add: ${passed} checks passed.`);
