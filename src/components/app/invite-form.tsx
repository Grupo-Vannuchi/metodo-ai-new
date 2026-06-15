"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { env } from "@/lib/env";
import { inviteMember, type InviteState } from "@/app/actions/organizations";

const initialState: InviteState = { error: null };

export function InviteForm() {
  const t = useTranslations("app.team");
  const locale = useLocale();
  const [state, action, pending] = useActionState(inviteMember, initialState);

  const inviteUrl = state.token
    ? `${env.NEXT_PUBLIC_SITE_URL}/invite/${state.token}`
    : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="email">{t("inviteEmail")}</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div>
          <Label htmlFor="role">{t("inviteRole")}</Label>
          <select
            id="role"
            name="role"
            defaultValue="MEMBER"
            className={cn(
              "h-[42px] rounded-lg border border-border bg-card px-3 text-sm",
              "focus-visible:border-brand focus-visible:outline-none",
            )}
          >
            <option value="MEMBER">{t("roleMember")}</option>
            <option value="ADMIN">{t("roleAdmin")}</option>
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? t("inviting") : t("invite")}
        </Button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-500">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}

      {inviteUrl ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm font-medium">{t("inviteCreated")}</p>
          <code className="mt-1 block break-all text-xs text-muted-foreground">
            {inviteUrl}
          </code>
        </div>
      ) : null}
    </form>
  );
}
