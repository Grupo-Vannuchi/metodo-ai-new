import "server-only";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { SessionRole } from "@/lib/session";
import { GATEABLE_SCREENS, ALWAYS_ALLOWED, type Screen } from "@/config/screens";

/**
 * Screen-level access control via templates.
 *
 * - OWNER / ADMIN always have full access (they manage the org).
 * - A MEMBER with NO template assigned has full access (default-open).
 * - A MEMBER WITH a template is restricted to that template's screens (plus the
 *   always-allowed ones). Persisted on the membership, so it stays until an
 *   admin changes or removes it, and applies on the member's next request.
 */
export function resolveAllowedScreens(
  role: SessionRole,
  templateScreens: string[] | null,
): string[] {
  if (role !== "MEMBER" || templateScreens === null) {
    return [...ALWAYS_ALLOWED, ...GATEABLE_SCREENS];
  }
  return [...ALWAYS_ALLOWED, ...templateScreens];
}

export function canAccessScreen(
  ctx: { allowedScreens: string[] },
  screen: string,
): boolean {
  return ctx.allowedScreens.includes(screen);
}

/**
 * Guard for a screen's route. Redirects restricted members to the dashboard.
 * Call in the screen's `layout.tsx` so it covers every sub-route.
 */
export async function requireScreen(
  ctx: { allowedScreens: string[] },
  screen: Screen,
  locale: Locale,
): Promise<void> {
  if (canAccessScreen(ctx, screen)) return;
  redirect({ href: "/app", locale });
}
