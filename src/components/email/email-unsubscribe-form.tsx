"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmEmailUnsubscribe } from "@/app/actions/email-unsubscribe";

/** The click is the consent: link scanners only GET the page, they don't press this. */
export function EmailUnsubscribeForm({ recipientId, sig }: { recipientId: string; sig: string }) {
  const t = useTranslations("emailUnsubscribe");
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <p className="inline-flex items-center gap-2 text-green-600">
        <CheckCircle2 className="size-5" />
        {t("done")}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await confirmEmailUnsubscribe(recipientId, sig);
            if (r.ok) setDone(true);
            else setFailed(true);
          })
        }
      >
        {pending ? t("processing") : t("confirm")}
      </Button>
      {failed ? <p className="text-sm text-red-600">{t("failed")}</p> : null}
    </div>
  );
}
