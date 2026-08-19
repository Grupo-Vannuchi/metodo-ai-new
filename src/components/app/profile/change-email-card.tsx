"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AtSign, MailCheck, Clock, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { requestEmailChange, cancelEmailChange } from "@/app/actions/email-change";

/**
 * Security-tab card to change the sign-in e-mail (double opt-in): the change is
 * confirmed from a link sent to the NEW address. Requires the current password
 * when the account has one. Shows the pending state until confirmed.
 */
export function ChangeEmailCard({
  currentEmail,
  hasPassword,
  pendingEmail,
}: {
  currentEmail: string;
  hasPassword: boolean;
  pendingEmail: string | null;
}) {
  const t = useTranslations("profile.emailChange");
  const ta = useTranslations("auth");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    setSentTo(null);
    start(async () => {
      const r = await requestEmailChange(fd);
      if (r.ok) {
        setSentTo(String(fd.get("email") ?? ""));
        setOpen(false);
        form.reset();
        router.refresh();
      } else {
        setError(t(`error.${r.error}`));
      }
    });
  }

  function onCancel() {
    setError(null);
    start(async () => {
      const r = await cancelEmailChange();
      if (r.ok) router.refresh();
      else setError(t("error.unknown"));
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <AtSign className="size-4 text-brand" />
        <h3 className="text-sm font-semibold">{t("title")}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("desc")}</p>

      {/* Current e-mail */}
      <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <MailCheck className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("current")}</p>
          <p className="truncate text-sm font-medium">{currentEmail}</p>
        </div>
      </div>

      {/* Pending change (if any) */}
      {pendingEmail ? (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3">
          <Clock className="size-5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("pending", { email: pendingEmail })}</p>
            <p className="text-xs text-muted-foreground">{t("pendingHint")}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
          >
            <X className="size-3.5" />
            {t("cancel")}
          </button>
        </div>
      ) : null}

      {sentTo ? (
        <p className="mt-3 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600">{t("sent", { email: sentTo })}</p>
      ) : null}

      {/* Change form (collapsed by default) */}
      {open ? (
        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
          <div>
            <Label htmlFor="newEmail">{t("newEmail")}</Label>
            <Input id="newEmail" name="email" type="email" autoComplete="email" required placeholder={t("newEmailPlaceholder")} />
          </div>
          {hasPassword ? (
            <div>
              <Label htmlFor="emailPassword">{t("currentPassword")}</Label>
              <PasswordInput
                id="emailPassword"
                name="password"
                autoComplete="current-password"
                required
                showLabel={ta("showPassword")}
                hideLabel={ta("hidePassword")}
              />
            </div>
          ) : null}

          {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t("sending") : t("cta")}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setOpen(false); setError(null); }}>
              {t("dismiss")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4">
          <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(true); setSentTo(null); }}>
            {pendingEmail ? t("changeAgain") : t("open")}
          </Button>
          {error ? <p role="alert" className="mt-2 text-sm text-red-500">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
