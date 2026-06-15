"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { signup, type AuthState } from "@/app/actions/auth";

const initialState: AuthState = { error: null };

export function SignupForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action, pending] = useActionState(signup, initialState);

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
