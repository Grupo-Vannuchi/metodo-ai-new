import type { DupGroup } from "@/lib/queries/duplicates";

/**
 * Which record the "Mesclar duplicados" window keeps in each group. Pure (no server, no React), so the
 * window and a check can share it.
 */

/** A group's identity across refreshes. Its position in the list is not one: a merge removes a group and
 * the ones below move up. */
export function dupGroupKey(g: DupGroup): string {
  return `${g.reason}:${g.key}`;
}

/** A name that is only a phone number: what the WhatsApp import saves when it knows no name. */
function looksLikePhone(name: string): boolean {
  return /^[\d\s()+.-]+$/.test(name.trim());
}

/** The suggested record to keep: most deals, then a real name over a bare phone number, then the oldest. */
export function suggestPrimary(g: DupGroup): string {
  return [...g.records].sort(
    (a, b) =>
      b.deals - a.deals ||
      Number(looksLikePhone(a.name)) - Number(looksLikePhone(b.name)) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )[0].id;
}

/**
 * The record kept when this group is merged: the user's pick if it is one of THIS group's records, else the
 * suggestion. Never an id from another group: until 19/11/2026 the pick was stored by list position, and
 * after a merge the next group inherited it, so its whole group was merged into another group's contact.
 */
export function primaryFor(g: DupGroup, picked: string | undefined): string {
  return picked && g.records.some((r) => r.id === picked) ? picked : suggestPrimary(g);
}
