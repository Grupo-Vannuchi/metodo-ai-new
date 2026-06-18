import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { getMyProfile } from "@/lib/queries/profile";
import { ProfileForm } from "@/components/app/profile-form";
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

  const profile = await getMyProfile(ctx.userId);
  if (!profile) {
    return <p className="text-muted-foreground">{t("notFound")}</p>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ProfileForm profile={profile} />
    </div>
  );
}
