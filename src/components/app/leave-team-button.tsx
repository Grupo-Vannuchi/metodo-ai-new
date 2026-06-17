"use client";

import { LogOut } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { leaveTeam } from "@/app/actions/organizations";
import { buttonVariants } from "@/components/ui/button";

/**
 * Leave the current team. A user belongs to one team; leaving signs them out so
 * they can accept another invite. Shown to non-owners only.
 */
export function LeaveTeamButton() {
  const t = useTranslations("settings");
  const locale = useLocale();
  return (
    <form
      action={leaveTeam}
      onSubmit={(e) => {
        if (!window.confirm(t("leaveTeamConfirm"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      <button type="submit" className={buttonVariants({ variant: "outline" })}>
        <LogOut className="size-4" />
        {t("leaveTeam")}
      </button>
    </form>
  );
}
