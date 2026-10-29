import type { useFormatter } from "next-intl";
import { saoPauloDayStart } from "@/lib/tasks/board-core";

/**
 * Times of "Adicionar a grupo do WhatsApp" on the screens. The window (8h to 20h) and the day of the cap are São Paulo's, so
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

/** The values the `forecast` message takes for a round that ends at `at`: which day, the time of day, and the date. */
export function forecastValues(format: Formatter, at: Date, now: Date) {
  return {
    day: dayOf(at, now),
    time: format.dateTime(at, { hour: "2-digit", minute: "2-digit", timeZone: GROUP_ADD_TIME_ZONE }),
    date: format.dateTime(at, { day: "2-digit", month: "2-digit", timeZone: GROUP_ADD_TIME_ZONE }),
  };
}
