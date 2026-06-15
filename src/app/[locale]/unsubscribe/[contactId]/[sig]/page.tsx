import { getTranslations, setRequestLocale } from "next-intl/server";
import { verifyUnsubscribeSig } from "@/lib/unsubscribe";
import { UnsubscribeForm } from "@/components/unsubscribe-form";
import { Logo } from "@/components/layout/logo";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ locale: string; contactId: string; sig: string }>;
}) {
  const { locale: rawLocale, contactId, sig } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("unsubscribe");

  const valid = verifyUnsubscribeSig(contactId, sig);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <Logo className="text-xl" />
        {valid ? (
          <>
            <h1 className="mt-4 text-lg font-semibold">{t("title")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("body")}</p>
            <div className="mt-6 flex justify-center">
              <UnsubscribeForm contactId={contactId} sig={sig} />
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold">{t("invalidTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("invalidBody")}</p>
          </>
        )}
      </div>
    </main>
  );
}
