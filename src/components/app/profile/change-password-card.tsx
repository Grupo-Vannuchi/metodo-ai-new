"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { changePassword, sendSetPasswordLink } from "@/app/actions/account";

/**
 * Security-tab card to change (or, for Google-only accounts, first-set) the
 * password. Shows the current-password field only when the account already
 * has one; a client-side confirm-match check runs before hitting the server.
 */
export function ChangePasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations("profile");
  const ta = useTranslations("auth");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);

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

  // An account without a password (Google/Microsoft only) sets the first one through a link sent to its e-mail.
  if (!hasPassword) {
    return (
      <div className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-brand" />
          <h3 className="text-sm font-semibold">{t("security.setTitle")}</h3>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("security.setDesc")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("security.setLinkHint")}</p>
        {linkSentTo ? <p className="mt-3 text-sm text-green-600">{t("security.setLinkSent", { email: linkSentTo })}</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-500">{error}</p> : null}
        <div className="mt-4">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => {
              setError(null);
              start(async () => {
                const r = await sendSetPasswordLink();
                if (r.ok) setLinkSentTo(r.email);
                else setError(r.error === "rate_limited" ? ta("errors.rate_limited") : t("security.error.unknown"));
              });
            }}
          >
            {pending ? t("saving") : t("security.setLinkCta")}
          </Button>
        </div>
      </div>
    );
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
            <PasswordInput id="currentPassword" name="currentPassword" autoComplete="current-password" required showLabel={ta("showPassword")} hideLabel={ta("hidePassword")} />
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="password">{t("security.newPassword")}</Label>
            <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required showLabel={ta("showPassword")} hideLabel={ta("hidePassword")} />
          </div>
          <div>
            <Label htmlFor="confirm">{t("security.confirmPassword")}</Label>
            <PasswordInput id="confirm" name="confirm" autoComplete="new-password" minLength={8} required showLabel={ta("showPassword")} hideLabel={ta("hidePassword")} />
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
