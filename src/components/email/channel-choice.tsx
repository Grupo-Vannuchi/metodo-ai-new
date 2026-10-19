"use client";

import { useEffect } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { emailListHref } from "@/lib/email-broadcast/list-channel";
import type { SenderAccountView } from "@/lib/email-broadcast/types";
import { SenderAccountPanel } from "@/components/email/sender-account-panel";
import { ChannelIcon } from "@/components/email/channel-icon";
import { cn } from "@/lib/utils";

/** What the OAuth callback left in the query string (already narrowed by the page). */
export type ChannelNotice = { provider: "MICROSOFT" | "GOOGLE"; connected: boolean; error: string | null };

/**
 * Platform, the company's Microsoft mailbox or its Google mailbox (specs
 * 2026-10-15 §7 and 2026-10-19). A mailbox card only shows when that channel is
 * enabled for the company. "compose" is the first step of "Novo e-mail";
 * "browse" is the E-mail page, which always asks before showing one channel's sends.
 */
export function ChannelChoice({
  microsoft,
  microsoftEnabled,
  google,
  googleEnabled,
  quotaLimit,
  notice = null,
  mode = "compose",
}: {
  microsoft: SenderAccountView | null;
  microsoftEnabled: boolean;
  google: SenderAccountView | null;
  googleEnabled: boolean;
  quotaLimit: number;
  notice?: ChannelNotice | null;
  mode?: "compose" | "browse";
}) {
  const t = useTranslations("emailBroadcast");
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const browse = mode === "browse";
  const three = microsoftEnabled && googleEnabled;
  const noticeProvider = notice?.provider ?? null;
  const noticeConnected = notice?.connected ?? false;
  const noticeError = notice?.error ?? null;

  // The callback's result arrives in the query string: say it once, then clean the URL.
  useEffect(() => {
    if (!noticeProvider || (!noticeConnected && !noticeError)) return;
    const isGoogle = noticeProvider === "GOOGLE";
    if (noticeConnected) toast(t(isGoogle ? "channel.googleConnectedToast" : "channel.connectedToast"));
    else if (noticeError) {
      toast(t(isGoogle ? `channel.googleError.${noticeError}` : `channel.error.${noticeError}`), { variant: "error" });
    }
    router.replace("/app/email/new");
  }, [noticeProvider, noticeConnected, noticeError, toast, t, router]);

  return (
    <div className="flex flex-col gap-4">
      <div className={cn("grid gap-6 md:grid-cols-2", three ? "max-w-6xl xl:grid-cols-3" : "max-w-5xl")}>
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-card">
              <ChannelIcon channel="plataforma" className="size-6" />
            </span>
            <h2 className="text-lg font-semibold">{t("channel.platformTitle")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("channel.platformBody")}</p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            <li>{t("channel.platformPoint1")}</li>
            <li>{t("channel.platformPoint2", { limit: format.number(quotaLimit) })}</li>
            <li>{t("channel.platformPoint3")}</li>
          </ul>
          <div className="mt-auto">
            <Link
              href={browse ? emailListHref("plataforma") : "/app/email/new?via=platform"}
              className={buttonVariants({ variant: "outline" })}
            >
              {browse ? t("channel.platformBrowse") : t("channel.platformContinue")}
            </Link>
          </div>
        </section>

        {microsoftEnabled ? (
          <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-card">
                <ChannelIcon channel="microsoft" className="size-6" />
              </span>
              <h2 className="text-lg font-semibold">{t("channel.microsoftTitle")}</h2>
            </div>
            <p className="text-sm text-muted-foreground">{t("channel.microsoftBody")}</p>
            <SenderAccountPanel
              provider="MICROSOFT"
              account={microsoft}
              action={
                browse ? undefined : (
                  <Link href="/app/email/new?via=microsoft" className={buttonVariants()}>
                    {t("channel.use")}
                  </Link>
                )
              }
            />
            {browse ? (
              <div className="mt-auto">
                <Link href={emailListHref("microsoft")} className={buttonVariants({ variant: "outline" })}>
                  {t("channel.microsoftBrowse")}
                </Link>
              </div>
            ) : null}
          </section>
        ) : null}

        {googleEnabled ? (
          <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-card">
                <ChannelIcon channel="google" className="size-6" />
              </span>
              <h2 className="text-lg font-semibold">{t("channel.googleTitle")}</h2>
            </div>
            <p className="text-sm text-muted-foreground">{t("channel.googleBody")}</p>
            <SenderAccountPanel
              provider="GOOGLE"
              account={google}
              action={
                browse ? undefined : (
                  <Link href="/app/email/new?via=google" className={buttonVariants()}>
                    {t("channel.use")}
                  </Link>
                )
              }
            />
            {browse ? (
              <div className="mt-auto">
                <Link href={emailListHref("google")} className={buttonVariants({ variant: "outline" })}>
                  {t("channel.googleBrowse")}
                </Link>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
