"use client";

import { useTranslations } from "next-intl";
import { Clock, Lock } from "lucide-react";
import { windowClosesAt } from "@/lib/whatsapp-cloud/window";

/** Faixa da janela de 24h. `now` vem de um relógio do pai (render puro, sem Date.now()). */
export function WindowBanner({ lastInboundAt, now }: { lastInboundAt: string | Date | null; now: number | null }) {
  const t = useTranslations("inboxOficial.inbox");
  if (now === null) return null;
  const closes = windowClosesAt(lastInboundAt);
  const left = closes ? closes.getTime() - now : 0;
  if (left <= 0) {
    return (
      <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
        <Lock className="size-3.5 shrink-0" />
        {t("windowClosed")}
      </div>
    );
  }
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
      <Clock className="size-3.5 shrink-0" />
      {t("windowOpen", { time: `${hours}h${String(minutes).padStart(2, "0")}` })}
    </div>
  );
}
