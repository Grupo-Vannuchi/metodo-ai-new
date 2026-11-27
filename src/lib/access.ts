import "server-only";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { SessionRole } from "@/lib/session";
import {
  GATEABLE_SCREENS,
  ALWAYS_ALLOWED,
  OPT_IN_SCREENS,
  type Screen,
} from "@/config/screens";
import { hasModule, SCREEN_MODULE, type ModuleId } from "@/config/modules";

/**
 * Screen-level access control via templates.
 *
 * - OWNER / ADMIN always have full access (they manage the org).
 * - A MEMBER with NO template assigned gets every gateable screen EXCEPT the
 *   `OPT_IN_SCREENS` (default-open, minus what must be granted explicitly —
 *   e.g. reading the company mailbox).
 * - A MEMBER WITH a template is restricted to that template's screens (plus the
 *   always-allowed ones); an opt-in screen is reachable only if the template
 *   lists it. Persisted on the membership, so it stays until an admin changes
 *   or removes it, and applies on the member's next request.
 */
export function resolveAllowedScreens(
  role: SessionRole,
  templateScreens: string[] | null,
): string[] {
  if (role !== "MEMBER") {
    return [...ALWAYS_ALLOWED, ...GATEABLE_SCREENS];
  }
  if (templateScreens === null) {
    return [
      ...ALWAYS_ALLOWED,
      ...GATEABLE_SCREENS.filter((s) => !OPT_IN_SCREENS.includes(s)),
    ];
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
 * For a server action that belongs to a screen: the screen's module is
 * installed AND the member may use the screen. A page gets both from its
 * `layout.tsx` (`requireScreen` + the module check), but an action is callable
 * by its id without loading the page, so it repeats the check itself (guia 04).
 * Screens no module owns (`feed`) only need the access check.
 */
export function canUseScreen(
  ctx: { modules: readonly string[]; allowedScreens: string[] },
  screen: Screen,
): boolean {
  const owner = SCREEN_MODULE[screen];
  if (owner !== undefined && !hasModule(ctx.modules, owner)) return false;
  return canAccessScreen(ctx, screen);
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

/**
 * Guard for a module's route. Redirects to the Loja when the org hasn't installed
 * the module — so a screen can't be used by direct URL without its module. Call
 * right after `requireScreen` in the screen's layout/page.
 */
export async function requireModule(
  ctx: { modules: string[] },
  moduleId: ModuleId,
  locale: Locale,
): Promise<void> {
  if (hasModule(ctx.modules, moduleId)) return;
  redirect({ href: "/app/loja", locale });
}
