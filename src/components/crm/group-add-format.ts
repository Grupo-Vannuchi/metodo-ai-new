import type { useFormatter } from "next-intl";
import { saoPauloDayStart } from "@/lib/tasks/board-core";
import { UNCERTAIN_REASONS } from "@/lib/whatsapp/group-add/core";

/**
 * What the screens of "Adicionar a grupo do WhatsApp" show that is decided apart from React, so `check:group-add` can pin it:
 * the times, and the note under each contact of a round. The window (8h to 20h) and the day of the cap are São Paulo's, so
 * every time is told in that zone, whatever the zone of the browser or of the server: the markup is the same on both sides.
 */
export const GROUP_ADD_TIME_ZONE = "America/Sao_Paulo";

type Formatter = ReturnType<typeof useFormatter>;

const DAY_MS = 86_400_000;

/**
 * Whether `at` falls on the same São Paulo day as `now` (or before it), on the next one, or later. Brazil has had no daylight
 * saving since 2019, so a São Paulo day is 24 hours and the difference of two day starts is a whole number of days.
 */
export function dayOf(at: Date, now: Date): "today" | "tomorrow" | "other" {
  const days = Math.round((saoPauloDayStart(at).getTime() - saoPauloDayStart(now).getTime()) / DAY_MS);
  if (days <= 0) return "today";
  return days === 1 ? "tomorrow" : "other";
}

/** The reasons with a note of their own under `crm.groupAdd.reason`, by the same name. */
const OWN_NOTES: ReadonlySet<string> = new Set([
  "no_phone",
  "opted_out",
  "not_mobile",
  "duplicate",
  "previous_uncertain",
  "no_invite_link",
  "invite_failed",
  "invite_uncertain",
  "group_full",
]);

const HTTP_REASON = /^http_(\d+)$/;

/** The note under a contact's status: the key of a message of `crm.groupAdd.reason`, and the code it shows (a refusal's). */
export type ReasonNote = { key: string; code?: string };

/**
 * The note under a contact's status on the tracking screen, from the reason its item records. A reason left in doubt
 * (UNCERTAIN_REASONS, the ones no later round redoes) says it could not be confirmed, so the screen and the next round
 * always agree; any other HTTP error says WhatsApp refused the add, with its code; the rest have a note of their own. Null
 * for a reason with none (one nobody writes yet): the status explains it, and it is not called a doubt.
 */
export function reasonNote(reason: string): ReasonNote | null {
  if (OWN_NOTES.has(reason)) return { key: reason };
  if ((UNCERTAIN_REASONS as readonly string[]).includes(reason)) return { key: "unconfirmed" };
  const http = HTTP_REASON.exec(reason);
  return http ? { key: "refused", code: http[1] } : null;
}

/** The waits of a running round that last minutes or hours: the window (until 08:00), the cap (until 08:00 tomorrow), Evolution. */
const LONG_WAITS: ReadonlySet<string> = new Set(["window", "cap", "unavailable"]);

/**
 * How often the tracking screen reads a queued or running round again: every 5 s, and once a minute while the round waits
 * for the window, the cap or Evolution (`waitReason`, as the page tells it: only while the wait lasts). Each read is a whole
 * server render, so 5 s through a night is hundreds of them for nothing; once a minute still shows the round coming back.
 */
export function trackingRefreshMs(waitReason: string | null): number {
  return waitReason !== null && LONG_WAITS.has(waitReason) ? 60_000 : 5_000;
}

/** The values the `forecast` message takes for a round that ends at `at`: which day, the time of day, and the date. */
export function forecastValues(format: Formatter, at: Date, now: Date) {
  return {
    day: dayOf(at, now),
    time: format.dateTime(at, { hour: "2-digit", minute: "2-digit", timeZone: GROUP_ADD_TIME_ZONE }),
    date: format.dateTime(at, { day: "2-digit", month: "2-digit", timeZone: GROUP_ADD_TIME_ZONE }),
  };
}
