"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Link } from "@/i18n/navigation";
import { verifyEmail } from "@/app/actions/auth-recovery";

/** Confirm-your-email form. A POST (not the GET link) consumes the token, so
 * e-mail scanners prefetching the link can't burn it. The account's password is
 * asked (src/app/actions/auth-recovery.ts says why): whoever didn't create the
 * account is pointed to "Esqueci a senha". On success the action verifies the
 * account and signs the user in. */
export function VerifyConfirm({ token }: { token: string }) {
  const t = useTranslations("auth.verify");
  const ta = useTranslations("auth");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<"invalid" | "wrong_password" | "rate_limited" | null>(null);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await verifyEmail(token, password, locale);
          if (r?.error) setError(r.error);
        });
      }}
    >
      <div>
        <Label htmlFor="verify-password">{t("passwordLabel")}</Label>
        <PasswordInput
          id="verify-password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          showLabel={ta("showPassword")}
          hideLabel={ta("hidePassword")}
        />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t("confirming") : t("confirm")}
      </Button>
      {error === "invalid" ? (
        <p role="alert" className="text-center text-sm text-red-500">
          {t("invalid")}{" "}
          <Link href="/login" className="font-medium text-brand underline underline-offset-4">
            {t("backToLogin")}
          </Link>
        </p>
      ) : error ? (
        <p role="alert" className="text-center text-sm text-red-500">
          {error === "wrong_password" ? t("wrongPassword") : ta("errors.rate_limited")}
        </p>
      ) : null}
      <p className="text-center text-xs text-muted-foreground">
        {t("notYou")}{" "}
        <Link href="/forgot" className="font-medium text-brand hover:underline">
          {ta("login.forgot")}
        </Link>
      </p>
    </form>
  );
}
