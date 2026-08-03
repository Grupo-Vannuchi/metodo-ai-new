"use client";

import { useTranslations } from "next-intl";
import { HardDrive } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** Empty state on /app/files when the user hasn't connected Drive yet — the
 * "connect here" flow (like the inbox's WhatsApp connect). */
export function DriveConnect({ configured, error }: { configured: boolean; error?: boolean }) {
  const t = useTranslations("files");
  return (
    <div className="glass flex flex-col items-center gap-4 rounded-2xl border border-border p-10 text-center shadow-sm">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <HardDrive className="size-7" />
      </span>
      <div>
        <h2 className="text-lg font-semibold">{t("connectTitle")}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("connectBody")}</p>
      </div>
      {error ? <p className="text-sm text-red-600">{t("connectError")}</p> : null}
      {configured ? (
        // Full navigation to the OAuth start route (server redirect).
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a href="/api/integrations/google-drive/connect" className={buttonVariants({ size: "lg" })}>
          <HardDrive className="size-4" />
          {t("connectCta")}
        </a>
      ) : (
        <p className="text-sm text-amber-600">{t("notConfigured")}</p>
      )}
    </div>
  );
}
