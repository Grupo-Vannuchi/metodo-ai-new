"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Copy, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "@/i18n/navigation";
import { duplicateEmailBroadcast, resumeEmailBroadcast } from "@/app/actions/email-broadcasts";

export function ReportActions({ id, canResume }: { id: string; canResume: boolean }) {
  const t = useTranslations("emailBroadcast");
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      {canResume ? (
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await resumeEmailBroadcast(id);
              if (!r.ok) toast(r.message ?? t(`error.${r.error}`), { variant: "error" });
              router.refresh();
            })
          }
        >
          <Play className="size-4" />
          {t("report.resume")}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await duplicateEmailBroadcast(id);
            if (r.ok) router.push(`/app/email/${r.id}/edit`);
            else toast(t(`error.${r.error}`), { variant: "error" });
          })
        }
      >
        <Copy className="size-4" />
        {t("report.duplicate")}
      </Button>
    </div>
  );
}
