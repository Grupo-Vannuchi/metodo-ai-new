"use client";

import { useActionState, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Link } from "@/i18n/navigation";
import { ProfileCoreFields } from "@/components/auth/profile-core-fields";
import { signup, type AuthState } from "@/app/actions/auth";
import { resendVerification } from "@/app/actions/auth-recovery";

const initialState: AuthState = { error: null };

export function SignupForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action, pending] = useActionState(signup, initialState);
  const [resendPending, startResend] = useTransition();
  const [resent, setResent] = useState(false);

  // Rigid gate: signup succeeded but the account must confirm its e-mail first.
  if (state.needsVerification) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <MailCheck className="size-9 text-brand" />
        <p className="text-sm text-muted-foreground">
          {t("signup.verifySent", { email: state.email ?? "" })}
        </p>
        {resent ? (
          <p className="text-xs text-muted-foreground">{t("login.resent")}</p>
        ) : (
          <button
            type="button"
            disabled={resendPending}
            onClick={() =>
              startResend(async () => {
                await resendVerification(state.email ?? "");
                setResent(true);
              })
            }
            className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
          >
            {resendPending ? t("login.resending") : t("login.resend")}
          </button>
        )}
        <Link href="/login" className="mt-2 text-sm font-medium text-brand underline underline-offset-4">
          {t("verify.backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />

      <div>
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" type="text" autoComplete="name" required />
      </div>

      <div>
        <Label htmlFor="organizationName">{t("organizationName")}</Label>
        <Input
          id="organizationName"
          name="organizationName"
          type="text"
          autoComplete="organization"
          required
        />
      </div>

      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <ProfileCoreFields />

      <div>
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-500">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t("submitting") : t("signup.submit")}
      </Button>
    </form>
  );
}
