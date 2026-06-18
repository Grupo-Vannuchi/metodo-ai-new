import { getTranslations } from "next-intl/server";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppNav } from "@/components/app/app-nav";
import { MobileNav } from "@/components/app/mobile-nav";
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
    <div className="flex min-h-screen bg-muted/20">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card p-4 md:flex">
        <div className="px-1 py-2">
          <Logo className="text-xl" />
        </div>

        <div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <p className="truncate text-sm font-medium">{ctx.organization.name}</p>
          <p className="text-xs text-muted-foreground">{ctx.organization.plan}</p>
        </div>

        <div className="mt-6 flex-1">
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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
          <div className="flex items-center gap-3">
            <MobileNav allowedScreens={navScreens} />
            <Logo className="text-lg" />
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <form action={logout.bind(null, locale)}>
              <button type="submit" aria-label={t("signOut")} className="text-muted-foreground">
                <LogOut className="size-5" />
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6 sm:p-8">
          <BackBar />
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
