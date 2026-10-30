/**
 * Parsing of the participants in Evolution's group info, of the names in its
 * contact list, and of the answers of the group calls of "Adicionar a grupo do
 * WhatsApp". Pure and free of `server-only` on purpose:
 * scripts/check-whatsapp-groups.ts and scripts/check-whatsapp-group-add.ts
 * import it.
 */

/** `name` only when Evolution knows one (see memberName). */
export type GroupParticipant = { number: string; admin: boolean; name?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Digits of a phone JID ("5511…@s.whatsapp.net", "…@c.us" or bare digits); "" for anything else. */
function phoneDigits(jid: string): string {
  if (jid.includes("@") && !jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@c.us")) return "";
  return jid.split("@")[0] ?? "";
}

/**
 * A name worth keeping, or undefined. Evolution fills a contact it has no name
 * for with the digits of its id, so a value made only of digits and phone
 * punctuation counts as no name.
 */
function memberName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.replace(/\s+/g, " ").trim();
  return name && !/^[\d\s+().-]+$/.test(name) ? name : undefined;
}

/**
 * Members with a real phone number. Newer WhatsApp identifies members by a
 * LID (`…@lid`, a privacy id that is NOT a phone number) and sends the number
 * itself in `phoneNumber`; members with neither are dropped, since importing
 * them would create contacts that can't receive messages. `name` comes from
 * Evolution's /group/participants, which fills it from the contacts it keeps.
 */
export function parseGroupParticipants(raw: readonly unknown[]): GroupParticipant[] {
  const out: GroupParticipant[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const id = String(p.id ?? "").trim();
    const jid = id.endsWith("@lid") ? String(p.phoneNumber ?? p.jid ?? p.pn ?? "").trim() : id;
    const number = phoneDigits(jid);
    if (!/^\d{10,15}$/.test(number)) continue;
    const admin = p.admin === "admin" || p.admin === "superadmin";
    const name = memberName(p.name) ?? memberName(p.notify);
    out.push(name ? { number, admin, name } : { number, admin });
  }
  return out;
}

/**
 * Digits of a phone JID, without the domain or the ":device" part
 * ("5511…:12@s.whatsapp.net" gives "5511…"). "" for a LID, a group or anything
 * else that is not a phone.
 */
export function jidDigits(jid: string): string {
  const user = phoneDigits(jid.trim()).split(":")[0] ?? "";
  return /^\d+$/.test(user) ? user : "";
}

/** A group as the group list shows it. `unresolved` counts the members parseGroupParticipants dropped (no number to read). */
export type EvoGroupSummary = {
  jid: string;
  subject: string;
  size: number;
  announce: boolean | null;
  participants: GroupParticipant[];
  unresolved: number;
};

const GROUP_JID = /^[^@\s]+@g\.us$/;

/**
 * The groups of a list answer: an array, or `{ groups: [...] }`. Whatever has
 * no group JID as its id is left out. `size` is the one Evolution reports, or
 * the number of members it listed when it reports none; `announce` is null
 * unless Evolution gives a boolean.
 */
export function parseGroupList(data: unknown): EvoGroupSummary[] {
  const list: unknown[] = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.groups) ? data.groups : [];
  const out: EvoGroupSummary[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const jid = typeof item.id === "string" ? item.id.trim() : "";
    if (!GROUP_JID.test(jid)) continue;
    const raw: unknown[] = Array.isArray(item.participants) ? item.participants : [];
    const participants = parseGroupParticipants(raw);
    out.push({
      jid,
      subject: typeof item.subject === "string" ? item.subject.trim() : "",
      size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : raw.length,
      announce: typeof item.announce === "boolean" ? item.announce : null,
      participants,
      unresolved: raw.length - participants.length,
    });
  }
  return out;
}

/**
 * Whether the number `ownDigits` is an admin of the group: true or false when
 * it is among the members that have a number. When it is not, false only if
 * every member had a number to read; a member without one (a LID with no
 * `phoneNumber`) could be it. There is no answer, null, in that case and when
 * `ownDigits` is empty.
 */
export function isAdminOf(
  group: Pick<EvoGroupSummary, "participants" | "unresolved">,
  ownDigits: string,
): boolean | null {
  if (!ownDigits) return null;
  const me = group.participants.find((p) => p.number === ownDigits);
  if (me) return me.admin;
  return group.unresolved > 0 ? null : false;
}

/**
 * The JID of the number an instance is linked to, from `fetchInstances`: v2
 * lists `{ name, ownerJid }` and v1 `{ instance: { instanceName, owner } }`.
 * Only the entry of `instance` counts; null when it has no number yet.
 */
export function ownerJidFrom(data: unknown, instance: string): string | null {
  const list: unknown[] = Array.isArray(data) ? data : [data];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const legacy = isRecord(item.instance) ? item.instance : null;
    if ((legacy ? legacy.instanceName : item.name) !== instance) continue;
    const owner = legacy ? legacy.owner : item.ownerJid;
    return typeof owner === "string" && owner.trim() ? owner.trim() : null;
  }
  return null;
}

/**
 * The code Baileys gave the number of an add: the `status` of the first of
 * `updateParticipants`, as text (it comes as "403" or as 403). Null when the
 * answer has none.
 */
export function participantUpdateCode(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.updateParticipants)) return null;
  const first: unknown = data.updateParticipants[0];
  if (!isRecord(first)) return null;
  const { status } = first;
  if (typeof status === "number" && Number.isFinite(status)) return String(status);
  return typeof status === "string" && status.trim() ? status.trim() : null;
}

/** Whether `whatsappNumbers` found a WhatsApp account for the number: the `exists` of the first answer. Null when there is none. */
export function existsOnWhatsapp(data: unknown): boolean | null {
  const first: unknown = Array.isArray(data) ? data[0] : undefined;
  return isRecord(first) && typeof first.exists === "boolean" ? first.exists : null;
}

const INVITE_URL = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/;
const INVITE_CODE = /^[A-Za-z0-9_-]+$/;

/**
 * The group's invite link from `inviteCode`: the `inviteUrl` when it is a
 * https://chat.whatsapp.com/ link, otherwise built from the `inviteCode`. A link
 * of any other kind is null, and no code next to it rescues it, since this text
 * goes out to people.
 */
export function inviteUrlFrom(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const url = typeof data.inviteUrl === "string" ? data.inviteUrl.trim() : "";
  if (url) return INVITE_URL.test(url) ? url : null;
  const code = typeof data.inviteCode === "string" ? data.inviteCode.trim() : "";
  return INVITE_CODE.test(code) ? `https://chat.whatsapp.com/${code}` : null;
}

/**
 * Names in Evolution's contact list (chat/findContacts) by the digits of their
 * phone JID; the first one wins. Contacts kept under a LID or a group JID are
 * left out: there is no number to match a member against.
 */
export function parseContactNames(raw: readonly unknown[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const number = phoneDigits(String(c.remoteJid ?? "").trim());
    const name = memberName(c.pushName);
    if (/^\d{10,15}$/.test(number) && name && !names.has(number)) names.set(number, name);
  }
  return names;
}

/**
 * Members still without a name take the one Evolution keeps for their number.
 * /group/participants matches contacts by the member's id, which for a LID
 * member is not the number the contact was saved under.
 */
export function withContactNames(
  members: readonly GroupParticipant[],
  names: ReadonlyMap<string, string>,
): GroupParticipant[] {
  return members.map((m) => {
    const name = m.name ? undefined : names.get(m.number);
    return name ? { ...m, name } : m;
  });
}
