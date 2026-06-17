import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { siteConfig } from "@/config/site";

/** Sticky marketing header: logo, anchor nav, theme toggle, login + signup. */
export async function MarketingHeader() {
  const nav = await getTranslations("nav");
  const c = await getTranslations("common");

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" aria-label={siteConfig.name}>
          <Logo />
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {siteConfig.nav.map((item) => {
            const cls = "transition-colors hover:text-foreground";
            return item.href.includes("#") ? (
              <a key={item.key} href={item.href.slice(item.href.indexOf("#"))} className={cls}>
                {nav(item.key)}
              </a>
            ) : (
              <Link key={item.key} href={item.href} className={cls}>
                {nav(item.key)}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {c("login")}
          </Link>
          <Link href="/signup" className={buttonVariants({ size: "sm" })}>
            {c("getStarted")}
          </Link>
        </div>
      </div>
    </header>
  );
}
