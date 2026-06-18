"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { leaveTeam } from "@/app/actions/organizations";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";

/**
 * Leave the current team. A user belongs to one team; leaving signs them out so
 * they can accept another invite. Shown to non-owners only.
 */
export function LeaveTeamButton() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const confirm = useConfirm();
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={async () => {
        const ok = await confirm({
          description: t("leaveTeamConfirm"),
          confirmLabel: t("leaveTeam"),
          variant: "danger",
        });
        if (!ok) return;
        const fd = new FormData();
        fd.set("locale", locale);
        start(() => {
          void leaveTeam(fd);
        });
      }}
    >
      <LogOut className="size-4" />
      {t("leaveTeam")}
    </Button>
  );
}
