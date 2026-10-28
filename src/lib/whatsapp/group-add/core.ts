import { brPhoneKey, looksLikeWhatsappMobile, normalizeWhatsappNumber } from "@/lib/phone";
import { saoPauloDayStart } from "@/lib/tasks/board-core";
import { normalizeGroupNumber } from "@/lib/whatsapp/group-import";

/**
 * Pure rules of "Adicionar a grupo do WhatsApp": who goes into a round, how the
 * answer to an add is read, when a round may run (08:00-20:00 in São Paulo, 100
 * people a day per number), the pause between people, the invite text and the
 * finish forecast. Free of `server-only` on purpose:
 * scripts/check-whatsapp-group-add.ts imports it.
 */

/** People a number may try per São Paulo day. */
export const GROUP_ADD_DAILY_CAP = 100;

/** Hours (São Paulo) when anything may go out: from `startHour` up to, not including, `endHour`. */
export const GROUP_ADD_WINDOW = { startHour: 8, endHour: 20 } as const;

/** Random pause between one person and the next, in whole seconds, both ends included. */
export const GROUP_ADD_PAUSE_SECONDS = { min: 30, max: 90 } as const;

/** Seconds per person in the forecast: the middle of the pause. */
export const GROUP_ADD_FORECAST_SECONDS = 60;

/** Participants a WhatsApp group takes. */
export const WHATSAPP_GROUP_MAX = 1024;

/** Contacts in one round. */
export const GROUP_ADD_MAX_CONTACTS = 1000;

/** Longest invite text, in characters. */
export const INVITE_TEXT_MAX = 1000;

export type GroupAddItemStatus =
  | "PENDING"
  | "PROCESSING"
  | "ADDED"
  | "INVITED"
  | "ALREADY_IN"
  | "NO_WHATSAPP"
  | "SKIPPED"
  | "LEFT_GROUP"
  | "ALREADY_INVITED"
  | "FAILED";

/** The statuses that count against a number's day: WhatsApp was asked about the person. */
export const CAP_COUNTED: readonly GroupAddItemStatus[] = ["ADDED", "INVITED", "FAILED"];

export type SkipReason = "no_phone" | "opted_out" | "not_mobile" | "duplicate";

/**
 * The number to dial for a phone typed in the CRM: country-coded digits, with
 * the 9 added to the older 12-digit BR mobiles, as the group import does.
 * Null when no number comes out of it.
 */
function dialingNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = normalizeWhatsappNumber(raw);
  return normalized ? normalizeGroupNumber(normalized) : null;
}

/**
 * Key that is the same for one number in any format: with or without 55, with
 * or without the 9 of older BR mobiles, masked or not. It is the number to dial
 * without the BR country code, at most 11 digits (`brPhoneKey`), so a
 * participant of the group and a contact of the CRM meet. Null when no number
 * comes out of the phone.
 */
export function phoneMatchKey(raw: string | null | undefined): string | null {
  const digits = dialingNumber(raw);
  return digits ? brPhoneKey(digits) || null : null;
}

/** `phone` is as typed in the CRM. */
export type CandidateInput = { contactId: string; name: string; phone: string | null; optedOut: boolean };

/** A number an earlier round for the same group added or sent the link to, as `phoneMatchKey`. */
export type PreviousOutcome = { phoneKey: string; status: "ADDED" | "INVITED" };

export type PlannedItem = {
  contactId: string;
  name: string;
  /** The number to dial (country-coded digits) when the typed phone yields one, otherwise the phone as typed. */
  phone: string | null;
  phoneKey: string | null;
  status: "PENDING" | "ALREADY_IN" | "NO_WHATSAPP" | "SKIPPED" | "LEFT_GROUP" | "ALREADY_INVITED";
  reason: SkipReason | null;
};

/**
 * What a round does with each contact, in the input order. The first rule that
 * matches wins: opt-out (the contact's own, or that of any contact of the
 * selection with the same number); no phone (no digits at all); not a mobile
 * (judged on the number to dial); already in the group (`participantKeys`);
 * added by an earlier round, so left the group; invited by an earlier round, so
 * did not join; the same number as an earlier contact; otherwise pending.
 * `participantKeys` and `previous` hold `phoneMatchKey` values.
 */
export function planGroupAdd(
  contacts: readonly CandidateInput[],
  participantKeys: ReadonlySet<string>,
  previous: readonly PreviousOutcome[],
): PlannedItem[] {
  const addedBefore = new Set<string>();
  const invitedBefore = new Set<string>();
  for (const outcome of previous) {
    if (outcome.status === "ADDED") addedBefore.add(outcome.phoneKey);
    else if (outcome.status === "INVITED") invitedBefore.add(outcome.phoneKey);
  }
  // An opt-out belongs to the person: it blocks every contact of the selection with the same number.
  const optedOutKeys = new Set<string>();
  for (const c of contacts) {
    const key = c.optedOut ? phoneMatchKey(c.phone) : null;
    if (key !== null) optedOutKeys.add(key);
  }
  const seen = new Set<string>();
  return contacts.map((c) => {
    const dialing = dialingNumber(c.phone);
    const phoneKey = phoneMatchKey(c.phone);
    const item = (status: PlannedItem["status"], reason: SkipReason | null = null): PlannedItem => ({
      contactId: c.contactId,
      name: c.name,
      phone: dialing ?? c.phone,
      phoneKey,
      status,
      reason,
    });
    if (c.optedOut || (phoneKey !== null && optedOutKeys.has(phoneKey))) return item("SKIPPED", "opted_out");
    if (!normalizeWhatsappNumber(c.phone ?? "")) return item("SKIPPED", "no_phone");
    // A mobile always has a key; the null test only narrows the type for the rules below.
    const mobile = dialing !== null && looksLikeWhatsappMobile(dialing);
    if (!mobile || phoneKey === null) return item("NO_WHATSAPP", "not_mobile");
    if (participantKeys.has(phoneKey)) return item("ALREADY_IN");
    if (addedBefore.has(phoneKey)) return item("LEFT_GROUP");
    if (invitedBefore.has(phoneKey)) return item("ALREADY_INVITED");
    if (seen.has(phoneKey)) return item("SKIPPED", "duplicate");
    seen.add(phoneKey);
    return item("PENDING");
  });
}

export type GroupAddCounts = {
  total: number;
  pending: number;
  alreadyIn: number;
  noWhatsapp: number;
  skipped: number;
  leftGroup: number;
  alreadyInvited: number;
};

/** The numbers of the review screen. Statuses that only exist while a round runs count in `total` only. */
export function countPlan(items: readonly { status: GroupAddItemStatus }[]): GroupAddCounts {
  const counts: GroupAddCounts = {
    total: items.length,
    pending: 0,
    alreadyIn: 0,
    noWhatsapp: 0,
    skipped: 0,
    leftGroup: 0,
    alreadyInvited: 0,
  };
  for (const { status } of items) {
    switch (status) {
      case "PENDING":
        counts.pending++;
        break;
      case "ALREADY_IN":
        counts.alreadyIn++;
        break;
      case "NO_WHATSAPP":
        counts.noWhatsapp++;
        break;
      case "SKIPPED":
        counts.skipped++;
        break;
      case "LEFT_GROUP":
        counts.leftGroup++;
        break;
      case "ALREADY_INVITED":
        counts.alreadyInvited++;
        break;
    }
  }
  return counts;
}

export type AddOutcome = "ADDED" | "NEEDS_INVITE" | "ALREADY_IN" | "FAILED";

/**
 * How one add was answered, from the status code Baileys returns for the
 * number: 200 added, 403 the person's privacy settings ask for the link
 * instead, 409 already a participant. The 403 and the 409 are the expected
 * codes, to be confirmed in the real test. Anything else, or no code, is a
 * failure.
 */
export function outcomeFromCode(code: string | null): AddOutcome {
  switch (code) {
    case "200":
      return "ADDED";
    case "403":
      return "NEEDS_INVITE";
    case "409":
      return "ALREADY_IN";
    default:
      return "FAILED";
  }
}

const HOUR_MS = 3_600_000;
const WINDOW_START_MS = GROUP_ADD_WINDOW.startHour * HOUR_MS;
const WINDOW_END_MS = GROUP_ADD_WINDOW.endHour * HOUR_MS;

/** Milliseconds since São Paulo midnight. */
function sinceMidnight(now: Date): number {
  return now.getTime() - saoPauloDayStart(now).getTime();
}

/** The window opening of the next São Paulo day. */
function nextMorning(now: Date): Date {
  return new Date(saoPauloDayStart(now, 1).getTime() + WINDOW_START_MS);
}

/** Whether anything may go out at `now`: from 08:00 up to, not including, 20:00 in São Paulo. */
export function isInsideWindow(now: Date): boolean {
  const ms = sinceMidnight(now);
  return ms >= WINDOW_START_MS && ms < WINDOW_END_MS;
}

/** `now` when it is inside the window, otherwise the next 08:00 in São Paulo. */
export function nextWindowStart(now: Date): Date {
  const ms = sinceMidnight(now);
  if (ms < WINDOW_START_MS) return new Date(saoPauloDayStart(now).getTime() + WINDOW_START_MS);
  if (ms >= WINDOW_END_MS) return nextMorning(now);
  return new Date(now.getTime());
}

/** When the next person may be tried: after the pause, and inside the window. */
export function nextAttemptAt(now: Date, pauseSeconds: number): Date {
  return nextWindowStart(new Date(now.getTime() + pauseSeconds * 1000));
}

/** When a round that spent the day's cap goes on: 08:00 of the next São Paulo day. */
export function capResumeAt(now: Date): Date {
  return nextMorning(now);
}

/** A pause between two people, in whole seconds from min to max. `random` is like `Math.random`: [0, 1). */
export function pickPauseSeconds(random: () => number): number {
  const { min, max } = GROUP_ADD_PAUSE_SECONDS;
  return min + Math.floor(random() * (max - min + 1));
}

const INVITE_VAR_RE = /\{\{\s*(nome|grupo)\s*\}\}/gi;

/**
 * The text of the private invite: `{{nome}}` and `{{grupo}}` filled in one
 * pass, as typed, and the group link on a line of its own at the end, unless
 * the text already ends with it. Throws without a link: an invite without it
 * must never go out.
 */
export function renderInvite(template: string, vars: { nome: string; grupo: string }, inviteUrl: string): string {
  const link = inviteUrl.trim();
  if (!link) throw new Error("renderInvite needs the group link");
  const text = template
    .replace(INVITE_VAR_RE, (_match, key: string) => (key.toLowerCase() === "grupo" ? vars.grupo : vars.nome))
    .trimEnd();
  if (text.endsWith(link)) return text;
  return text ? `${text}\n\n${link}` : link;
}

/**
 * When the last of `remaining` people is done, simulated person by person: each
 * takes GROUP_ADD_FORECAST_SECONDS, starting at `nextWindowStart`, and counts
 * against its São Paulo day (`usedToday` is what today already spent; the count
 * starts over on a new day). At the cap the next one waits for `capResumeAt`.
 */
export function forecastFinish(now: Date, remaining: number, usedToday: number): Date {
  let t = new Date(now.getTime());
  let used = usedToday;
  let day = saoPauloDayStart(t).getTime();
  for (let i = 0; i < remaining; i++) {
    if (used >= GROUP_ADD_DAILY_CAP) t = capResumeAt(t);
    t = nextWindowStart(t);
    const today = saoPauloDayStart(t).getTime();
    if (today !== day) {
      day = today;
      used = 0;
    }
    t = new Date(t.getTime() + GROUP_ADD_FORECAST_SECONDS * 1000);
    used++;
  }
  return t;
}
