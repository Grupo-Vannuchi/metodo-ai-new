import { getTranslations } from "next-intl/server";
import { Instagram, Linkedin, Youtube, Mail } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { Link } from "@/i18n/navigation";
import { siteConfig } from "@/config/site";

export async function MarketingFooter() {
  const nav = await getTranslations("nav");
  const c = await getTranslations("common");
  const t = await getTranslations("home.footer");
  const year = siteConfig.foundedYear;

  const socials = [
    { href: siteConfig.social.instagram, Icon: Instagram, label: "Instagram" },
    { href: siteConfig.social.linkedin, Icon: Linkedin, label: "LinkedIn" },
    { href: siteConfig.social.youtube, Icon: Youtube, label: "YouTube" },
  ].filter((s) => Boolean(s.href));

  return (
    <footer id="contact" className="scroll-mt-20 border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-sm text-muted-foreground">{t("tagline")}</p>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <span className="font-semibold">{t("product")}</span>
            {siteConfig.nav.map((item) => {
              const cls = "text-muted-foreground hover:text-foreground";
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
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              {c("login")}
            </Link>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <span className="font-semibold">{t("contactTitle")}</span>
            <a href={`mailto:${siteConfig.contact.email}`} className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <Mail className="size-4" />
              {siteConfig.contact.email}
            </a>
            {socials.length > 0 ? (
              <div className="mt-2 flex gap-3">
                {socials.map(({ href, Icon, label }) => (
                  <a key={label} href={href!} target="_blank" rel="noopener noreferrer" aria-label={label} className="text-muted-foreground hover:text-foreground">
                    <Icon className="size-5" />
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-1 border-t border-border pt-6 text-xs text-muted-foreground">
          <p>© {year} {siteConfig.legalName}. {t("rights")}</p>
        </div>
      </div>
    </footer>
  );
}
