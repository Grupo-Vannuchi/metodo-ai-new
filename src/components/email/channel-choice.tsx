"use client";

import { Suspense, useEffect } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Inbox } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { emailListHref } from "@/lib/email-broadcast/list-channel";
import type { SenderAccountView } from "@/lib/email-broadcast/types";
import { SenderAccountPanel } from "@/components/email/sender-account-panel";
import { ChannelIcon } from "@/components/email/channel-icon";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "@/components/email/inbox/unread-badge";

/** What the OAuth callback left in the query string (already narrowed by the page). */
export type ChannelNotice = { provider: "MICROSOFT" | "GOOGLE"; connected: boolean; error: string | null };

/**
 * Platform, the company's Microsoft mailbox, its Google mailbox or its SMTP
 * account (specs 2026-10-15 §7, 2026-10-19 and 2026-10-21 §6). The Microsoft and
 * Google cards only show when that channel is enabled for the company; the
 * platform and SMTP cards always do. "compose" is the first step of "Novo
 * e-mail"; "browse" is the E-mail page, which always asks before showing one
 * channel's sends.
 */
export function ChannelChoice({
  microsoft,
  microsoftEnabled,
  google,
  googleEnabled,
  smtp,
  quotaLimit,
  notice = null,
  mode = "compose",
  inbox = null,
  smtpInbox = null,
}: {
  microsoft: SenderAccountView | null;
  microsoftEnabled: boolean;
  google: SenderAccountView | null;
  googleEnabled: boolean;
  smtp: SenderAccountView | null;
  quotaLimit: number;
  notice?: ChannelNotice | null;
  mode?: "compose" | "browse";
  /** Browse mode, when the member may read the connected mailbox's Inbox. */
  inbox?: { href: string; unread: Promise<number | null> | null } | null;
  /** Browse mode, when the member may read the Inbox of the SMTP account (it has IMAP set up). */
  smtpInbox?: { href: string; unread: Promise<number | null> | null } | null;
}) {
  const t = useTranslations("emailBroadcast");
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const browse = mode === "browse";
  // Platform and SMTP are always there. Three cards fit one row on a wide screen; two or four make
  // two columns (so four are 2 x 2).
  const cards = 2 + Number(microsoftEnabled) + Number(googleEnabled);
  const three = cards === 3;
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
              <div className="mt-auto flex flex-wrap gap-2">
                {inbox ? (
                  <Link href={inbox.href} className={buttonVariants()}>
                    <Inbox aria-hidden="true" className="size-4" />
                    {t("inbox.open")}
                    {inbox.unread ? (
                      <Suspense fallback={null}>
                        <UnreadBadge count={inbox.unread} className="bg-brand-foreground text-brand" />
                      </Suspense>
                    ) : null}
                  </Link>
                ) : null}
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

        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-card">
              <ChannelIcon channel="smtp" className="size-6" />
            </span>
            <h2 className="text-lg font-semibold">{t("channel.smtpTitle")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("channel.smtpBody")}</p>
          <SenderAccountPanel
            provider="SMTP"
            account={smtp}
            action={
              browse ? undefined : (
                <Link href="/app/email/new?via=smtp" className={buttonVariants()}>
                  {t("channel.use")}
                </Link>
              )
            }
          />
          {browse ? (
            <div className="mt-auto flex flex-wrap gap-2">
              {smtpInbox ? (
                <Link href={smtpInbox.href} className={buttonVariants()}>
                  <Inbox aria-hidden="true" className="size-4" />
                  {t("inbox.open")}
                  {smtpInbox.unread ? (
                    <Suspense fallback={null}>
                      <UnreadBadge count={smtpInbox.unread} className="bg-brand-foreground text-brand" />
                    </Suspense>
                  ) : null}
                </Link>
              ) : null}
              <Link href={emailListHref("smtp")} className={buttonVariants({ variant: "outline" })}>
                {t("channel.smtpBrowse")}
              </Link>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
