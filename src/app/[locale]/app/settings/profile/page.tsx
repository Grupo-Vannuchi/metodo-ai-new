import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { getMyProfile, getMyAccountSecurity } from "@/lib/queries/profile";
import { ProfileClient } from "@/components/app/profile-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("profile");

  const [profile, security] = await Promise.all([
    getMyProfile(ctx.userId),
    getMyAccountSecurity(ctx.userId),
  ]);
  if (!profile || !security) {
    return <p className="text-muted-foreground">{t("notFound")}</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <ProfileClient profile={profile} security={security} />
    </div>
  );
}
