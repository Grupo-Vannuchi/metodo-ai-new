import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { getOrgContext } from "@/lib/tenant";
import { LoginForm } from "@/components/auth/login-form";
import { Logo } from "@/components/layout/logo";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function LoginPage({
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
        <h1 className="text-lg font-semibold">{t("login.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("login.subtitle")}</p>
      </div>
      <LoginForm />
      <p className="text-center text-sm text-muted-foreground">
        {t("login.noAccount")}{" "}
        <Link href="/signup" className="font-medium text-brand underline underline-offset-4">
          {t("signup.cta")}
        </Link>
      </p>
    </div>
  );
}
