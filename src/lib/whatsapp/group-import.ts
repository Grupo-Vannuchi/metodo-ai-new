import { brPhoneKey, formatBrPhone } from "@/lib/phone";

/**
 * Pure rules of "Adicionar aos contatos" for WhatsApp groups: members become
 * contacts in the group's folder under the name Evolution knows for them (the
 * phone when it knows none), and numbers already in the CRM are skipped. Free
 * of `server-only` on purpose: scripts/check-whatsapp-groups.ts imports it.
 */

/** Groups per click: each one is an Evolution call, and the request must finish in time. */
export const MAX_IMPORT_GROUPS = 20;

/**
 * Country-coded digits of a member's number, or null when it can't be one.
 * Older BR mobiles keep the 8-digit form in their WhatsApp id (55 + DDD + 8
 * digits); mobiles start with 6–9, so they get the 9 and match the CRM's format.
 */
export function normalizeGroupNumber(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length < 10 || d.length > 15) return null;
  if (d.length === 12 && d.startsWith("55") && /[6-9]/.test(d[4])) return `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

/** How the number is stored on the contact: "(11) 98765-4321" for BR, "+447911123456" otherwise. */
export function phoneForContact(digits: string): string {
  const br = digits.startsWith("55") && (digits.length === 12 || digits.length === 13);
  return br ? formatBrPhone(digits) : `+${digits}`;
}

export type PlannedContact = { name: string; phone: string; key: string };

/**
 * What one group adds: a contact per new number, named after the member or,
 * when Evolution has no name, after the phone (a contact needs a name). Skips
 * invalid numbers, repeats within the group and keys in `existingKeys`
 * (brPhoneKey of every phone already in the CRM).
 */
export function planGroupImport(
  members: readonly { number: string; name?: string }[],
  existingKeys: ReadonlySet<string>,
): { create: PlannedContact[]; skipped: number } {
  const seen = new Set<string>();
  const create: PlannedContact[] = [];
  let skipped = 0;
  for (const m of members) {
    const digits = normalizeGroupNumber(m.number);
    const key = digits ? brPhoneKey(digits) : "";
    if (!digits || !key || seen.has(key) || existingKeys.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const phone = phoneForContact(digits);
    create.push({ name: m.name ?? phone, phone, key });
  }
  return { create, skipped };
}
