"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutOtherDevices } from "@/app/actions/account";

/**
 * Security-tab card: "Sair dos outros aparelhos". Ends every other session of the account (a lost phone, a shared computer)
 * and keeps this one (src/app/actions/account.ts).
 */
export function SignOutOthersCard() {
  const t = useTranslations("profile.security");
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "done" | "error">("idle");

  function run() {
    setState("idle");
    start(async () => {
      const r = await signOutOtherDevices();
      setState(r.ok ? "done" : "error");
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <MonitorSmartphone className="size-4 text-brand" />
        <h3 className="text-sm font-semibold">{t("othersTitle")}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("othersDesc")}</p>
      {state === "done" ? <p className="mt-3 text-sm text-green-600">{t("othersDone")}</p> : null}
      {state === "error" ? (
        <p role="alert" className="mt-3 text-sm text-red-500">
          {t("error.unknown")}
        </p>
      ) : null}
      <div className="mt-4">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={run}>
          {pending ? t("othersRunning") : t("othersCta")}
        </Button>
      </div>
    </div>
  );
}
