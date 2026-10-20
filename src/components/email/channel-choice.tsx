"use client";

import { Suspense, useEffect } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Inbox } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { emailListHref } from "@/lib/email-broadcast/list-channel";
import type { SenderAccountView } from "@/lib/email-broadcast/types";
import { MicrosoftAccountPanel } from "@/components/email/microsoft-account-panel";
import { ChannelIcon } from "@/components/email/channel-icon";
import { UnreadBadge } from "@/components/email/inbox/unread-badge";

type ConnectError = "cancelled" | "admin_required" | "not_configured" | "failed";

/**
 * Platform or the company's Microsoft mailbox (spec 2026-10-15 §7). "compose"
 * is the first step of "Novo e-mail"; "browse" is the E-mail page, which
 * always asks before showing one channel's sends.
 */
export function ChannelChoice({
  account,
  quotaLimit,
  connected = false,
  error = null,
  mode = "compose",
  inbox = null,
}: {
  account: SenderAccountView | null;
  quotaLimit: number;
  connected?: boolean;
  error?: ConnectError | null;
  mode?: "compose" | "browse";
  /** Browse mode, when the member may read the connected mailbox's Inbox. */
  inbox?: { href: string; unread: Promise<number | null> | null } | null;
}) {
  const t = useTranslations("emailBroadcast");
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const browse = mode === "browse";

  // The callback's result arrives in the query string: say it once, then clean the URL.
  useEffect(() => {
    if (!connected && !error) return;
    if (connected) toast(t("channel.connectedToast"));
    else if (error) toast(t(`channel.error.${error}`), { variant: "error" });
    router.replace("/app/email/new");
  }, [connected, error, toast, t, router]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid max-w-5xl gap-6 md:grid-cols-2">
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

        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-card">
              <ChannelIcon channel="microsoft" className="size-6" />
            </span>
            <h2 className="text-lg font-semibold">{t("channel.microsoftTitle")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("channel.microsoftBody")}</p>
          <MicrosoftAccountPanel
            account={account}
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
      </div>
    </div>
  );
}
