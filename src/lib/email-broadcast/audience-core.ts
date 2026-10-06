import { isValidEmail, normalizeEmail } from "./normalize";

/**
 * The pure core of the audience resolution: every address found in every
 * selected source goes in, one recipient per normalized address comes out.
 * No DB here (src/lib/email-broadcast/audience.ts does the queries) so the
 * dedupe rules are checked by scripts/check-email-broadcast.ts.
 */

export type CandidateSource = "contact" | "company" | "manual";

/** One address as found in one place (a contact, a company or the typed list). */
export type Candidate = {
  email: string;
  source: CandidateSource;
  name?: string | null;
  companyName?: string | null;
  contactId?: string | null;
  companyId?: string | null;
};

export type ResolvedRecipient = {
  email: string;
  name: string | null;
  companyName: string | null;
  sources: CandidateSource[];
  contactId: string | null;
  companyId: string | null;
};

/** Invariant: selected − invalid − duplicates − suppressed = total. */
export type AudienceStats = {
  selected: number;
  invalid: number;
  duplicates: number;
  suppressed: number;
  total: number;
};

/** Which source names the recipient ({{nome}}/{{empresa}}) when an address repeats. */
const PRIORITY: Record<CandidateSource, number> = { contact: 0, company: 1, manual: 2 };

export function mergeCandidates(
  candidates: readonly Candidate[],
  blocked: ReadonlySet<string>,
): { recipients: ResolvedRecipient[]; stats: AudienceStats; invalidEmails: string[] } {
  const byEmail = new Map<string, { recipient: ResolvedRecipient; rank: number }>();
  const invalidEmails: string[] = [];
  let valid = 0;

  for (const c of candidates) {
    const email = normalizeEmail(c.email);
    if (!isValidEmail(email)) {
      invalidEmails.push(email);
      continue;
    }
    valid++;
    const rank = PRIORITY[c.source];
    const seen = byEmail.get(email);
    if (!seen) {
      byEmail.set(email, {
        rank,
        recipient: {
          email,
          name: c.name ?? null,
          companyName: c.companyName ?? null,
          sources: [c.source],
          contactId: c.contactId ?? null,
          companyId: c.companyId ?? null,
        },
      });
      continue;
    }
    const r = seen.recipient;
    if (!r.sources.includes(c.source)) r.sources.push(c.source);
    if (!r.contactId && c.contactId) r.contactId = c.contactId;
    if (!r.companyId && c.companyId) r.companyId = c.companyId;
    if (rank < seen.rank) {
      seen.rank = rank;
      r.name = c.name ?? r.name;
      r.companyName = c.companyName ?? r.companyName;
    } else {
      if (!r.name && c.name) r.name = c.name;
      if (!r.companyName && c.companyName) r.companyName = c.companyName;
    }
  }

  const unique = [...byEmail.values()].map((v) => v.recipient);
  for (const r of unique) r.sources.sort((a, b) => PRIORITY[a] - PRIORITY[b]);
  // Deterministic order: batch numbers (and so the batch idempotency keys)
  // must not depend on query order.
  const recipients = unique
    .filter((r) => !blocked.has(r.email))
    .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));

  return {
    recipients,
    invalidEmails,
    stats: {
      selected: candidates.length,
      invalid: invalidEmails.length,
      duplicates: valid - unique.length,
      suppressed: unique.length - recipients.length,
      total: recipients.length,
    },
  };
}
