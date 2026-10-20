/**
 * ─────────────────────────────────────────────────────────────────────────
 *  SCREENS — gateable areas of the app for access templates
 * ─────────────────────────────────────────────────────────────────────────
 * Access templates grant MEMBERs access to a subset of these screens. The
 * dashboard is always available; settings is role-gated (ADMIN+), so neither is
 * listed here. Keys mirror the nav keys / route segments.
 */

export const GATEABLE_SCREENS = [
  "feed",
  "crm",
  "proposals",
  "tasks",
  "prospecting",
  "campaigns",
  "email",
  "emailInbox",
  "inbox",
  "companies",
  "contacts",
  "connections",
  "finance",
  "hr",
  "supplies",
  "downloader",
] as const;

export type Screen = (typeof GATEABLE_SCREENS)[number];

/**
 * Gateable screens left OUT of the default-open set. A MEMBER without a
 * template gets every gateable screen except these; they must be granted
 * explicitly by an access template. OWNER / ADMIN always have them.
 * `emailInbox` reads the company's connected mailbox (password resets, 2FA
 * codes, personal mail), so it is opt-in.
 */
export const OPT_IN_SCREENS: readonly Screen[] = ["emailInbox"];

/** Screens every authenticated member can always reach (no template needed). */
export const ALWAYS_ALLOWED: readonly string[] = ["dashboard", "settings"];

export function isGateableScreen(value: string): value is Screen {
  return (GATEABLE_SCREENS as readonly string[]).includes(value);
}
