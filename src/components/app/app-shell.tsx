import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { LogOut, Store, Settings } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileNav } from "@/components/app/mobile-nav";
import { NotificationBell } from "@/components/app/notification-bell";
import { Sidebar } from "@/components/app/sidebar";
import { AssistantWidget } from "@/components/app/assistant/assistant-widget";
import { NotificationSound } from "@/components/app/notification-sound";
import { CommandPalette } from "@/components/app/command-palette";
import { RealtimeProvider } from "@/components/app/realtime-provider";
import { SearchTrigger } from "@/components/app/search-trigger";
import { BackBar } from "@/components/app/back-bar";
import { PageTransition } from "@/components/app/page-transition";
import { logout } from "@/app/actions/auth";
import { Link } from "@/i18n/navigation";
import { availableScreens, hasFeatureByModules } from "@/config/modules";
import { listAccountCompanies } from "@/lib/queries/accounts";
import { LIMITS } from "@/config/limits";
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

  // Show only screens whose module the org installed (MetodoLoja); the member's
  // access template still applies on top. Core screens are always available.
  const available = availableScreens(ctx.modules);
  const navScreens = ctx.allowedScreens.filter((s) => available.has(s));

  const collapsed = (await cookies()).get("sidebar_collapsed")?.value === "1";
  const assistantEnabled = hasFeatureByModules(ctx.modules, "assistant");

  // Company switcher (owner-only): the account's companies + whether a new one fits.
  const companies = ctx.isAccountOwner ? await listAccountCompanies(ctx.userId) : [];
  const canCreateCompany = companies.length < LIMITS.companiesPerAccount;

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
      <CommandPalette allowedScreens={navScreens} />
      {/* Opaque branded surface — NOT glass: a translucent navy washes out over
          the light canvas and makes its inner boxes (search, org card) read as
          mismatched tones. Collapsible to an icon rail. */}
      <Sidebar
        orgName={ctx.organization.name}
        orgId={ctx.organizationId}
        companies={companies}
        isAccountOwner={ctx.isAccountOwner}
        canCreateCompany={canCreateCompany}
        userName={ctx.user.name}
        userEmail={ctx.user.email}
        navScreens={navScreens}
        logoutAction={logout.bind(null, locale)}
        initialCollapsed={collapsed}
      />

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="glass-strong flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <div className="flex items-center gap-3">
            <MobileNav allowedScreens={navScreens} />
            <Logo className="text-lg" />
          </div>
          <div className="flex items-center gap-1">
            <SearchTrigger variant="icon" />
            <NotificationBell />
            <Link href="/app/loja" aria-label={t("loja")} title={t("loja")} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Store className="size-5" />
            </Link>
            <Link href="/app/settings" aria-label={t("settings")} title={t("settings")} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Settings className="size-5" />
            </Link>
            <ThemeToggle />
            <form action={logout.bind(null, locale)}>
              <button type="submit" aria-label={t("signOut")} className="text-muted-foreground">
                <LogOut className="size-5" />
              </button>
            </form>
          </div>
        </header>

        {/* Desktop top bar — config cluster (Loja, Configurações) beside the theme
            toggle. The sidebar is reserved for modules and their pages. */}
        <header className="hidden items-center justify-end gap-1 border-b border-border px-6 py-2.5 md:flex">
          <Link
            href="/app/loja"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Store className="size-4" />
            {t("loja")}
          </Link>
          <Link
            href="/app/settings"
            aria-label={t("settings")}
            title={t("settings")}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings className="size-4" />
          </Link>
          <ThemeToggle />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-8">
          <BackBar />
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      {assistantEnabled ? <AssistantWidget userName={ctx.user.name} /> : null}
    </div>
    </RealtimeProvider>
  );
}
