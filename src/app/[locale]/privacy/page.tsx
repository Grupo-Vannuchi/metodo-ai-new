import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { resolveLocale, type Locale } from "@/i18n/routing";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { LegalDocument, type LegalContent } from "@/components/marketing/legal-document";
import pt from "@/messages/legal/privacy.pt.json";
import en from "@/messages/legal/privacy.en.json";

/** Date of the last change to the policy text — update it with every edit. */
const UPDATED_AT = "2026-09-28";

/** `satisfies` makes `typecheck` fail if either locale drifts from the shape. */
const CONTENT = { pt, en } satisfies Record<Locale, LegalContent>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const content = CONTENT[resolveLocale((await params).locale)];
  return { title: content.title, description: content.description };
}

/**
 * Public privacy policy. Unlike /pricing it must NOT redirect signed-in users:
 * Meta requires this URL (Privacy Policy URL and, via `#data-deletion`, the
 * data deletion instructions) to open for anyone, logged in or not.
 */
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <LegalDocument content={CONTENT[locale]} locale={locale} updatedAt={UPDATED_AT} />
      </main>
      <MarketingFooter />
    </div>
  );
}
