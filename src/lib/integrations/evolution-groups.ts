/**
 * Parsing of the participants in Evolution's group info and of the names in its
 * contact list. Pure and free of `server-only` on purpose:
 * scripts/check-whatsapp-groups.ts imports it.
 */

/** `name` only when Evolution knows one (see memberName). */
export type GroupParticipant = { number: string; admin: boolean; name?: string };

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
