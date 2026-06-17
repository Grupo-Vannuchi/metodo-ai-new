"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "@/i18n/navigation";
import { startCampaign } from "@/app/actions/campaigns";

export function StartButton({ id, status }: { id: string; status: string }) {
  const t = useTranslations("campaigns");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A never-sent campaign shows "start"; once it has run, it can be re-dispatched.
  const label = status === "DRAFT" ? t("start") : t("restart");

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startCampaign(id);
            if (!r.ok) setError(t(`error.${r.error}`));
            router.refresh();
          })
        }
      >
        {pending ? <Spinner className="size-4" /> : <Send className="size-4" />}
        {pending ? t("starting") : label}
      </Button>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
