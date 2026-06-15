"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { unsubscribeContact } from "@/app/actions/unsubscribe";

export function UnsubscribeForm({
  contactId,
  sig,
}: {
  contactId: string;
  sig: string;
}) {
  const t = useTranslations("unsubscribe");
  const [done, setDone] = useState(false);
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
    <Button
      type="button"
      size="lg"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await unsubscribeContact(contactId, sig);
          if (r.ok) setDone(true);
        })
      }
    >
      {pending ? t("processing") : t("confirm")}
    </Button>
  );
}
