import { getTranslations } from "next-intl/server";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppNav } from "@/components/app/app-nav";
import { MobileNav } from "@/components/app/mobile-nav";
import { NotificationBell } from "@/components/app/notification-bell";
import { NotificationSound } from "@/components/app/notification-sound";
import { CommandPalette } from "@/components/app/command-palette";
import { RealtimeProvider } from "@/components/app/realtime-provider";
import { SearchTrigger } from "@/components/app/search-trigger";
import { BackBar } from "@/components/app/back-bar";
import { PageTransition } from "@/components/app/page-transition";
import { logout } from "@/app/actions/auth";
import { hasFeature, type PlanKey } from "@/config/plans";
import type { OrgContext } from "@/lib/tenant";
import type { Locale } from "@/i18n/routing";

export async function AppShell({
  ctx,
  locale,
  children,
}: {
  ctx: OrgContext;
  locale: Locale;
  children: React.ReactNode;
}) {
  const t = await getTranslations("app.nav");

  // Hide plan-gated screens the org can't use (finance = PLUS+). Access-template
  // gating still applies on top of this.
  const navScreens = ctx.allowedScreens.filter(
    (s) => s !== "finance" || hasFeature(ctx.organization.plan as PlanKey, "finance"),
  );

  return (
    <RealtimeProvider>
    <NotificationSound />
    <div className="relative flex h-screen overflow-hidden bg-muted/40 dark:bg-muted/20">
      {/* Decorative, blurred brand backdrop — gives every screen a sense of depth
          behind the frosted surfaces (and something for the glass to frost over,
          so the effect reads on a light canvas too). The blobs drift slowly like
          a lava lamp. Brand-blue leads; the green accent stays a whisper so it
          never looks like a stain. Frozen under prefers-reduced-motion. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-40 size-[34rem] animate-lava-a rounded-full bg-brand/12 blur-3xl will-change-transform dark:bg-brand/20" />
        <div className="absolute bottom-[-12rem] left-1/4 size-[30rem] animate-lava-b rounded-full bg-brand/10 blur-3xl will-change-transform dark:bg-brand/[0.12]" />
        {/* Green accent stays dark-mode only — in light it read as a stray tint. */}
        <div className="absolute right-[-10rem] top-1/3 hidden size-[28rem] animate-lava-c rounded-full bg-accent/10 blur-3xl will-change-transform dark:block" />
      </div>
      <CommandPalette />
      {/* Opaque branded surface — NOT glass: a translucent navy washes out over
          the light canvas and makes its inner boxes (search, org card) read as
          mismatched tones. */}
      <aside className="sidebar-brand relative z-10 hidden w-64 shrink-0 flex-col border-r border-border bg-card p-4 md:flex">
        <div className="flex items-center justify-between gap-2 px-1 py-2">
          <Logo onDark className="text-xl" />
          <NotificationBell align="left" />
        </div>

        <div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <p className="truncate text-sm font-medium">{ctx.organization.name}</p>
          <p className="text-xs text-muted-foreground">{ctx.organization.plan}</p>
        </div>

        <div className="mt-4">
          <SearchTrigger variant="box" />
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <AppNav allowedScreens={navScreens} />
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2 px-3 py-1">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{ctx.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{ctx.user.email}</p>
            </div>
            <ThemeToggle className="shrink-0" />
          </div>
          <form action={logout.bind(null, locale)}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-4" />
              {t("signOut")}
            </button>
          </form>
        </div>
      </aside>

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="glass-strong flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <div className="flex items-center gap-3">
            <MobileNav allowedScreens={navScreens} />
            <Logo className="text-lg" />
          </div>
          <div className="flex items-center gap-2">
            <SearchTrigger variant="icon" />
            <NotificationBell />
            <ThemeToggle />
            <form action={logout.bind(null, locale)}>
              <button type="submit" aria-label={t("signOut")} className="text-muted-foreground">
                <LogOut className="size-5" />
              </button>
            </form>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-8">
          <BackBar />
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
    </RealtimeProvider>
  );
}
