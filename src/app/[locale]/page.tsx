import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { siteConfig } from "@/config/site";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "home" });
  const c = await getTranslations({ locale, namespace: "common" });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 px-6 py-24 text-center">
      <span className="rounded-full border border-border bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
        {siteConfig.name}
      </span>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        {t("hero.title")}
      </h1>
      <p className="max-w-2xl text-lg text-muted-foreground">
        {t("hero.subtitle")}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/signup"
          className="rounded-lg bg-brand px-5 py-3 font-medium text-brand-foreground transition-opacity hover:opacity-90"
        >
          {t("hero.ctaPrimary")}
        </Link>
        <Link
          href="/pricing"
          className="rounded-lg border border-border px-5 py-3 font-medium transition-colors hover:bg-muted"
        >
          {t("hero.ctaSecondary")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        <Link href="/login" className="underline underline-offset-4">
          {c("login")}
        </Link>
      </p>
    </main>
  );
}
