import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { getOrgContext } from "@/lib/tenant";
import { LoginForm } from "@/components/auth/login-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { configuredProviders } from "@/lib/oauth/providers";
import { parseOAuthError } from "@/lib/oauth/shared";
import { Logo } from "@/components/layout/logo";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  if (await getOrgContext()) redirect({ href: "/app", locale });

  const t = await getTranslations("auth");
  const oauthError = parseOAuthError((await searchParams)?.error);
  const hasOAuth = configuredProviders().length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo className="text-xl" />
        <h1 className="text-lg font-semibold">{t("login.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("login.subtitle")}</p>
      </div>

      {oauthError ? (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-center text-sm text-red-500">
          {t(`errors.${oauthError.key}`, { provider: oauthError.provider })}
        </p>
      ) : null}

      {hasOAuth ? (
        <>
          <OAuthButtons />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t("or")}
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}

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
