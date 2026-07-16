import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getOrgContext } from "@/lib/tenant";
import { ResetForm } from "@/components/auth/reset-form";
import { Logo } from "@/components/layout/logo";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ResetPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);
  if (await getOrgContext()) redirect({ href: "/app", locale });

  const t = await getTranslations("auth.reset");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo className="text-xl" />
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ResetForm token={token} />
    </div>
  );
}
