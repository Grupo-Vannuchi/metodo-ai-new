import { getTranslations, setRequestLocale } from "next-intl/server";
import { Check } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/layout/logo";
import { PRICING } from "@/config/pricing";
import { planConfig, type PlanKey } from "@/config/plans";
import { buttonVariants } from "@/components/ui/button";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

const UNLIMITED_THRESHOLD = 1_000_000;

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("pricing");

  const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");
  const fmt = (limit: number | null) =>
    limit === null || limit >= UNLIMITED_THRESHOLD ? t("unlimited") : nf.format(limit);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        <Link href="/">
          <Logo className="text-xl" />
        </Link>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="max-w-2xl text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-4">
        {PRICING.map((entry) => {
          const cfg = planConfig(entry.key as PlanKey);
          const bullets = [
            t("seats", { n: fmt(cfg.seatLimit) }),
            t("connections", { n: fmt(cfg.connectionsLimit) }),
            t("dispatch", { n: fmt(cfg.dispatchQuotaPerMonth) }),
          ];
          return (
            <div
              key={entry.key}
              className={cn(
                "flex flex-col rounded-2xl border bg-card p-6",
                entry.highlight ? "border-brand shadow-md" : "border-border",
              )}
            >
              {entry.highlight ? (
                <span className="mb-2 inline-flex w-fit rounded-full bg-brand px-3 py-0.5 text-xs font-medium text-brand-foreground">
                  {t("recommended")}
                </span>
              ) : null}
              <h2 className="text-lg font-semibold">{t(`plans.${entry.key}`)}</h2>
              <p className="mt-2 text-2xl font-bold">{entry.price}</p>

              <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm">
                {bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                    <span>{b}</span>
                  </li>
                ))}
                <li className="flex items-start gap-2 text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                  <span>{t("includedCore")}</span>
                </li>
              </ul>

              <Link
                href="/signup"
                className={cn(
                  "mt-6",
                  buttonVariants({ variant: entry.highlight ? "primary" : "outline", size: "lg" }),
                )}
              >
                {t("cta")}
              </Link>
            </div>
          );
        })}
      </div>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4">
          {t("backHome")}
        </Link>
      </p>
    </main>
  );
}
