"use client";

import { useState, useTransition } from "react";
import { Mail, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sendTestEmail } from "@/app/actions/settings-email";

/** Admin action: fire a transactional test email to yourself to validate the
 * email setup (domain/DKIM/SPF) before the product depends on it. */
export function TestEmailButton() {
  const t = useTranslations("settings.email");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMsg(null);
          start(async () => {
            const r = await sendTestEmail();
            setMsg(
              r.ok
                ? { ok: true, text: t("sent", { to: r.to }) }
                : { ok: false, text: t(`error.${r.error}`) },
            );
          });
        }}
        className={cn(buttonVariants({ variant: "outline" }), "disabled:opacity-50")}
      >
        {pending ? <Spinner className="size-4" /> : <Mail className="size-4" />}
        {t("test")}
      </button>
      {msg ? (
        <span
          className={cn(
            "flex items-center gap-1.5 text-sm",
            msg.ok ? "text-green-600" : "text-red-500",
          )}
        >
          {msg.ok ? <CheckCircle2 className="size-4" /> : null}
          {msg.text}
        </span>
      ) : null}
    </div>
  );
}
