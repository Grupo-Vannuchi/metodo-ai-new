"use client";

import { useActionState, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Link } from "@/i18n/navigation";
import { login, type AuthState } from "@/app/actions/auth";
import { resendVerification } from "@/app/actions/auth-recovery";

const initialState: AuthState = { error: null };

export function LoginForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action, pending] = useActionState(login, initialState);
  const [resendPending, startResend] = useTransition();
  const [resent, setResent] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />

      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t("password")}</Label>
          <Link href="/forgot" className="text-xs font-medium text-brand hover:underline">
            {t("login.forgot")}
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          showLabel={t("showPassword")}
          hideLabel={t("hidePassword")}
        />
      </div>

      {state.error === "email_not_verified" ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-medium">{t("errors.email_not_verified")}</p>
          {resent ? (
            <p className="mt-1 text-xs text-muted-foreground">{t("login.resent")}</p>
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
              className="mt-1 text-xs font-medium text-brand hover:underline disabled:opacity-50"
            >
              {resendPending ? t("login.resending") : t("login.resend")}
            </button>
          )}
        </div>
      ) : state.error ? (
        <p role="alert" className="text-sm text-red-500">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t("submitting") : t("login.submit")}
      </Button>
    </form>
  );
}
