/**
 * Self-check for the pure rules of "Adicionar a grupo do WhatsApp" (no DB, no
 * network, no env). Run with `npm run check:group-add`; exits non-zero on the
 * first failure.
 */
import assert from "node:assert/strict";
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

console.log(`\n✅ group-add: ${passed} checks passed.`);
