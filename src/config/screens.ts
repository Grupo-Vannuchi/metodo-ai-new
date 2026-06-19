/**
 * ─────────────────────────────────────────────────────────────────────────
 *  SCREENS — gateable areas of the app for access templates
 * ─────────────────────────────────────────────────────────────────────────
 * Access templates grant MEMBERs access to a subset of these screens. The
 * dashboard is always available; settings is role-gated (ADMIN+), so neither is
 * listed here. Keys mirror the nav keys / route segments.
 */

export const GATEABLE_SCREENS = [
  "crm",
  "tasks",
  "prospecting",
  "campaigns",
  "inbox",
  "companies",
  "contacts",
  "connections",
  "finance",
] as const;

export type Screen = (typeof GATEABLE_SCREENS)[number];

/** Screens every authenticated member can always reach (no template needed). */
export const ALWAYS_ALLOWED: readonly string[] = ["dashboard", "settings"];

export function isGateableScreen(value: string): value is Screen {
  return (GATEABLE_SCREENS as readonly string[]).includes(value);
}
