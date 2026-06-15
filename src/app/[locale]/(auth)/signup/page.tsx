import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { getOrgContext } from "@/lib/tenant";
import { SignupForm } from "@/components/auth/signup-form";
import { Logo } from "@/components/layout/logo";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  if (await getOrgContext()) redirect({ href: "/app", locale });

  const t = await getTranslations("auth");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo className="text-xl" />
        <h1 className="text-lg font-semibold">{t("signup.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("signup.subtitle")}</p>
      </div>
      <SignupForm />
      <p className="text-center text-sm text-muted-foreground">
        {t("signup.hasAccount")}{" "}
        <Link href="/login" className="font-medium text-brand underline underline-offset-4">
          {t("login.cta")}
        </Link>
      </p>
    </div>
  );
}
