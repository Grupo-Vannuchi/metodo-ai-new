"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { login, type AuthState } from "@/app/actions/auth";

const initialState: AuthState = { error: null };

export function LoginForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action, pending] = useActionState(login, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />

      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div>
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {state.error ? (
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
