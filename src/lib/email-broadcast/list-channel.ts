/**
 * Which channel the E-mail sends list shows (`/app/email?canal=`). Entering
 * E-mail always asks first; the choice lives only in the URL so back/reload
 * keep it. Pure: the pages and check:email share it.
 */

import type { MailboxChannel } from "./failure-reason";

export type ListChannel = "plataforma" | "microsoft" | "google";

/** Which mailbox channels this company may use right now (the platform is always there). */
export type ListChannelAvailability = { microsoft: boolean; google: boolean };

/**
 * The list's channel from `?canal=` (null = show the choice). With no mailbox
 * channel available there is nothing to choose; a channel that isn't available
 * (not configured, or outside the pilot) asks again instead of showing it.
 */
export function listChannelFromParam(
  param: string | string[] | undefined,
  available: ListChannelAvailability,
): ListChannel | null {
  if (!available.microsoft && !available.google) return "plataforma";
  const value = Array.isArray(param) ? param[0] : param;
  if (value === "plataforma") return "plataforma";
  if (value === "microsoft" && available.microsoft) return "microsoft";
  if (value === "google" && available.google) return "google";
  return null;
}

/** The sends list for a channel (null = the choice screen). */
export function emailListHref(channel: ListChannel | null): string {
  return channel ? `/app/email?canal=${channel}` : "/app/email";
}

/** The list a send belongs to, from its stored channel. */
export function listChannelOf(channel: MailboxChannel): ListChannel {
  if (channel === "MICROSOFT") return "microsoft";
  if (channel === "GOOGLE") return "google";
  return "plataforma";
}

/** The stored channel a list shows. */
export function broadcastChannelOf(channel: ListChannel): MailboxChannel {
  if (channel === "microsoft") return "MICROSOFT";
  if (channel === "google") return "GOOGLE";
  return "PLATFORM";
}
