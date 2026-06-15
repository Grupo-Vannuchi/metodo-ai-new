"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
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
        </>
      ) : null}

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
