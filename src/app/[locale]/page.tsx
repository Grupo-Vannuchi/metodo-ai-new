import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  KanbanSquare,
  Radar,
  Send,
  Cable,
  ShieldCheck,
  BarChart3,
  ArrowRight,
  Check,
  Quote,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { BackgroundImage } from "@/components/layout/background-image";
import { PlansGrid } from "@/components/marketing/plans-grid";
import { buttonVariants } from "@/components/ui/button";

const FEATURES = [
  { key: "crm", Icon: KanbanSquare },
  { key: "prospecting", Icon: Radar },
  { key: "campaigns", Icon: Send },
  { key: "connections", Icon: Cable },
  { key: "access", Icon: ShieldCheck },
  { key: "insights", Icon: BarChart3 },
] as const;

const STEPS = ["1", "2", "3"] as const;
const TESTIMONIALS = ["t1", "t2", "t3"] as const;
const FAQS = ["q1", "q2", "q3", "q4"] as const;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "home" });

  return (
    <div className="flex min-h-screen flex-col">
      <BackgroundImage />
      <MarketingHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-6 py-20 text-center sm:py-28 animate-fade-in-up">
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
            {t("hero.badge")}
          </span>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            {t("hero.title")}
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">{t("hero.subtitle")}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className={buttonVariants({ size: "lg" })}>
              {t("hero.ctaPrimary")}
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/pricing" className={buttonVariants({ variant: "outline", size: "lg" })}>
              {t("hero.ctaSecondary")}
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">{t("hero.note")}</p>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t("features.title")}</h2>
            <p className="mt-3 text-muted-foreground">{t("features.subtitle")}</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ key, Icon }) => (
              <div key={key} className="rounded-2xl border border-border bg-card p-6">
                <div className="flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold">{t(`features.items.${key}.title`)}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{t(`features.items.${key}.desc`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="bg-muted/30">
          <div className="mx-auto w-full max-w-6xl px-6 py-16">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight">{t("how.title")}</h2>
              <p className="mt-3 text-muted-foreground">{t("how.subtitle")}</p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <div key={s} className="rounded-2xl border border-border bg-card p-6">
                  <span className="flex size-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-foreground">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-semibold">{t(`how.steps.${s}.title`)}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{t(`how.steps.${s}.desc`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Plans */}
        <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t("plans.title")}</h2>
            <p className="mt-3 text-muted-foreground">{t("plans.subtitle")}</p>
          </div>
          <div className="mt-12">
            <PlansGrid locale={locale} />
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            <Link href="/pricing" className="underline underline-offset-4">{t("plans.seeAll")}</Link>
          </p>
        </section>

        {/* Testimonials */}
        <section className="bg-muted/30">
          <div className="mx-auto w-full max-w-6xl px-6 py-16">
            <h2 className="text-center text-3xl font-bold tracking-tight">{t("testimonials.title")}</h2>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {TESTIMONIALS.map((k) => (
                <figure key={k} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
                  <Quote className="size-6 text-brand" />
                  <blockquote className="flex-1 text-sm text-muted-foreground">{t(`testimonials.items.${k}.quote`)}</blockquote>
                  <figcaption className="text-sm">
                    <span className="font-semibold">{t(`testimonials.items.${k}.author`)}</span>
                    <span className="block text-muted-foreground">{t(`testimonials.items.${k}.role`)}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto w-full max-w-3xl px-6 py-16">
          <h2 className="text-center text-3xl font-bold tracking-tight">{t("faq.title")}</h2>
          <div className="mt-10 flex flex-col gap-4">
            {FAQS.map((k) => (
              <details key={k} className="group rounded-xl border border-border bg-card p-5">
                <summary className="flex cursor-pointer items-center justify-between font-medium">
                  {t(`faq.items.${k}.q`)}
                  <span className="ml-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{t(`faq.items.${k}.a`)}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-24">
          <div className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-brand/5 px-6 py-14 text-center">
            <h2 className="max-w-2xl text-3xl font-bold tracking-tight">{t("cta.title")}</h2>
            <p className="max-w-xl text-muted-foreground">{t("cta.subtitle")}</p>
            <div className="flex flex-col items-center gap-4">
              <Link href="/signup" className={buttonVariants({ size: "lg" })}>
                {t("cta.button")}
                <ArrowRight className="size-4" />
              </Link>
              <ul className="flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
                <li className="flex items-center gap-1.5"><Check className="size-4 text-brand" />{t("cta.perk1")}</li>
                <li className="flex items-center gap-1.5"><Check className="size-4 text-brand" />{t("cta.perk2")}</li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
