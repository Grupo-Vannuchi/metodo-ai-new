import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { verifyEmailUnsubscribeSig } from "@/lib/email-broadcast/unsubscribe";
import { EmailUnsubscribeForm } from "@/components/email/email-unsubscribe-form";
import { Logo } from "@/components/layout/logo";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function EmailUnsubscribePage({
  params,
}: {
  params: Promise<{ locale: string; recipientId: string; sig: string }>;
}) {
  const { locale: rawLocale, recipientId, sig } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("emailUnsubscribe");

  // Public page, no session: only after the HMAC checks out do we read which
  // org sent it (system context, row authorized by the signature).
  const valid = verifyEmailUnsubscribeSig(recipientId, sig);
  const recipient = valid
    ? await prisma.emailBroadcastRecipient.findFirst({
        where: { id: recipientId },
        select: { organizationId: true },
      })
    : null;
  const org = recipient
    ? await prisma.organization.findFirst({ where: { id: recipient.organizationId }, select: { name: true } })
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <Logo className="text-xl" />
        {recipient ? (
          <>
            <h1 className="mt-4 text-lg font-semibold">{t("title")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("body", { org: org?.name ?? "" })}</p>
            <div className="mt-6 flex justify-center">
              <EmailUnsubscribeForm recipientId={recipientId} sig={sig} />
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
