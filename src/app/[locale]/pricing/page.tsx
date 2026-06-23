import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { Logo } from "@/components/layout/logo";
import { PlansGrid } from "@/components/marketing/plans-grid";
import { getSession } from "@/lib/session";
import { resolveLocale } from "@/i18n/routing";

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  // Pricing is a public marketing page — signed-in users belong in the app.
  if (await getSession()) redirect({ href: "/app/crm", locale });

  const t = await getTranslations("pricing");

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        <Link href="/">
          <Logo />
        </Link>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="max-w-2xl text-muted-foreground">{t("subtitle")}</p>
      </header>

      <PlansGrid locale={locale} />

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4">
          {t("backHome")}
        </Link>
      </p>
    </main>
  );
}
