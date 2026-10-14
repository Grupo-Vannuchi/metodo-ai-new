/**
 * Parsing of the participants in Evolution's group info. Pure and free of
 * `server-only` on purpose: scripts/check-whatsapp-groups.ts imports it.
 */

export type GroupParticipant = { number: string; admin: boolean };

/** Digits of a phone JID ("5511…@s.whatsapp.net", "…@c.us" or bare digits); "" for anything else. */
function phoneDigits(jid: string): string {
  if (jid.includes("@") && !jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@c.us")) return "";
  return jid.split("@")[0] ?? "";
}

/**
 * Members with a real phone number. Newer WhatsApp identifies members by a
 * LID (`…@lid`, a privacy id that is NOT a phone number) and sends the number
 * itself in `phoneNumber`; members with neither are dropped, since importing
 * them would create contacts that can't receive messages.
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
    out.push({ number, admin: p.admin === "admin" || p.admin === "superadmin" });
  }
  return out;
}
