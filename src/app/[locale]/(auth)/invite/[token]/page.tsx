import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { hashInvitationToken, isInvitationExpired } from "@/lib/invitations";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { Logo } from "@/components/layout/logo";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);

  const t = await getTranslations("auth");

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    include: { organization: { select: { name: true } } },
  });

  const invalid =
    !invitation ||
    invitation.acceptedAt !== null ||
    isInvitationExpired(invitation.expiresAt);

  if (invalid) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <Logo className="text-xl" />
        <h1 className="text-lg font-semibold">{t("invite.invalidTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("invite.invalidBody")}</p>
        <Link href="/login" className="text-sm font-medium text-brand underline underline-offset-4">
          {t("login.cta")}
        </Link>
      </div>
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo className="text-xl" />
        <h1 className="text-lg font-semibold">{t("invite.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("invite.subtitle", {
            org: invitation.organization.name,
            email: invitation.email,
          })}
        </p>
      </div>
      <AcceptInviteForm token={token} existingUser={existingUser !== null} />
    </div>
  );
}
