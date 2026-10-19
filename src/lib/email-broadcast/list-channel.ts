/**
 * Which channel the E-mail sends list shows (`/app/email?canal=`). Entering
 * E-mail always asks first; the choice lives only in the URL so back/reload
 * keep it. Pure: the pages and check:email share it.
 */

export type ListChannel = "plataforma" | "microsoft";

const LIST_CHANNELS: readonly ListChannel[] = ["plataforma", "microsoft"];

/** The list's channel from `?canal=` (null = show the choice). Without the Microsoft app there is nothing to choose. */
export function listChannelFromParam(
  param: string | string[] | undefined,
  microsoftConfigured: boolean,
): ListChannel | null {
  if (!microsoftConfigured) return "plataforma";
  const value = Array.isArray(param) ? param[0] : param;
  return (LIST_CHANNELS as readonly string[]).includes(value ?? "") ? (value as ListChannel) : null;
}

/** The sends list for a channel (null = the choice screen). */
export function emailListHref(channel: ListChannel | null): string {
  return channel ? `/app/email?canal=${channel}` : "/app/email";
}

/** The list a send belongs to, from its stored channel. */
export function listChannelOf(channel: "PLATFORM" | "MICROSOFT"): ListChannel {
  return channel === "MICROSOFT" ? "microsoft" : "plataforma";
}

/** The stored channel a list shows. */
export function broadcastChannelOf(channel: ListChannel): "PLATFORM" | "MICROSOFT" {
  return channel === "microsoft" ? "MICROSOFT" : "PLATFORM";
}
