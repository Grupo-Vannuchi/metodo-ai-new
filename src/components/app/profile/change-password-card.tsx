"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { changePassword } from "@/app/actions/account";

/**
 * Security-tab card to change (or, for Google-only accounts, first-set) the
 * password. Shows the current-password field only when the account already
 * has one; a client-side confirm-match check runs before hitting the server.
 */
export function ChangePasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations("profile");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    setSaved(false);

    const password = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    if (password.length < 8) return setError(t("security.errorTooShort"));
    if (password !== confirm) return setError(t("security.errorMismatch"));

    start(async () => {
      const r = await changePassword(fd);
      if (r.ok) {
        setSaved(true);
        form.reset();
        router.refresh();
      } else {
        setError(t(`security.error.${r.error}`));
      }
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-brand" />
        <h3 className="text-sm font-semibold">{hasPassword ? t("security.changeTitle") : t("security.setTitle")}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {hasPassword ? t("security.changeDesc") : t("security.setDesc")}
      </p>

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        {hasPassword ? (
          <div>
            <Label htmlFor="currentPassword">{t("security.currentPassword")}</Label>
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="password">{t("security.newPassword")}</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          <div>
            <Label htmlFor="confirm">{t("security.confirmPassword")}</Label>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
          </div>
        </div>

        {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
        {saved ? <p className="text-sm text-green-600">{t("security.saved")}</p> : null}

        <div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? t("saving") : hasPassword ? t("security.changeCta") : t("security.setCta")}
          </Button>
        </div>
      </form>
    </div>
  );
}
