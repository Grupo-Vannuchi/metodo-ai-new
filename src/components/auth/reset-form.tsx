"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Link } from "@/i18n/navigation";
import { resetPassword } from "@/app/actions/auth-recovery";

/** Choose a new password from a reset link. */
export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("auth.reset");
  const ta = useTranslations("auth");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <CheckCircle2 className="size-8 text-green-600" />
        <p className="text-sm text-muted-foreground">{t("done")}</p>
        <Link href="/login" className="text-sm font-medium text-brand underline underline-offset-4">
          {t("goToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await resetPassword({ token, password });
          if (r.ok) setDone(true);
          else setError(t(`error.${r.error}`));
        });
      }}
    >
      <div>
        <Label htmlFor="password">{t("newPassword")}</Label>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          showLabel={ta("showPassword")}
          hideLabel={ta("hidePassword")}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("hint")}</p>
      </div>
      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
      <Button type="submit" size="lg" disabled={pending || password.length < 8}>
        {pending ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
