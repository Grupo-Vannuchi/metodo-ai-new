"use client";

import { useActionState, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MailCheck } from "lucide-react";
import { resendVerification } from "@/app/actions/auth-recovery";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { ProfileCoreFields } from "@/components/auth/profile-core-fields";
import { Link } from "@/i18n/navigation";
import { acceptInvitation, type AcceptState } from "@/app/actions/organizations";

const initialState: AcceptState = { error: null };

export function AcceptInviteForm({
  token,
  existingUser,
}: {
  token: string;
  existingUser: boolean;
}) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action, pending] = useActionState(
    acceptInvitation,
    initialState,
  );
  const [resendPending, startResend] = useTransition();
  const [resent, setResent] = useState(false);

  // New account: it confirms its e-mail before the first login, like a signup (the same message and resend link).
  if (state.needsVerification) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <MailCheck className="size-9 text-brand" />
        <p className="text-sm text-muted-foreground">{t("signup.verifySent", { email: state.email ?? "" })}</p>
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
      </div>
    );
  }

  if (state.joinedExisting) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <p className="text-sm text-muted-foreground">{t("invite.joined")}</p>
        <Link
          href="/login"
          className="rounded-lg bg-brand px-5 py-3 font-medium text-brand-foreground transition-opacity hover:opacity-90"
        >
          {t("login.submit")}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />

      {!existingUser ? (
        <>
          <div>
            <Label htmlFor="name">{t("name")}</Label>
            <Input id="name" name="name" type="text" autoComplete="name" required />
          </div>
          <ProfileCoreFields />
          <div>
            <Label htmlFor="password">{t("password")}</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              showLabel={t("showPassword")}
              hideLabel={t("hidePassword")}
            />
          </div>
        </>
      ) : (
        <div>
          <p className="mb-3 text-sm text-muted-foreground">{t("invite.existingHint")}</p>
          <Label htmlFor="password">{t("invite.existingPassword")}</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            required
            showLabel={t("showPassword")}
            hideLabel={t("hidePassword")}
          />
          <Link href="/forgot" className="mt-2 inline-block text-xs font-medium text-brand hover:underline">
            {t("login.forgot")}
          </Link>
        </div>
      )}

      {state.error ? (
        <p role="alert" className="text-sm text-red-500">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t("submitting") : t("invite.submit")}
      </Button>
    </form>
  );
}
