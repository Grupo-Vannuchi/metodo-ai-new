"use client";

import { useTransition, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "@/i18n/navigation";
import { disconnectMicrosoftAccount } from "@/app/actions/email-sender-accounts";
import type { SenderAccountView } from "@/lib/email-broadcast/types";

/** Full navigation (not a client route): the API redirects to Microsoft. */
const CONNECT_URL = "/api/email/microsoft/connect";

/**
 * The company's Microsoft sending account: connect (none), reconnect
 * (NEEDS_RECONNECT) or the connected mailbox with switch / disconnect.
 * `action` goes first in the connected mailbox's buttons.
 */
export function MicrosoftAccountPanel({ account, action }: { account: SenderAccountView | null; action?: ReactNode }) {
  const t = useTranslations("emailBroadcast");
  const format = useFormatter();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, start] = useTransition();

  async function onSwitch() {
    if (!account) return;
    const ok = await confirm({
      description: t("channel.switchConfirm", { email: account.email }),
      confirmLabel: t("channel.switchConfirmLabel"),
    });
    if (ok) window.location.assign(new URL(CONNECT_URL, window.location.origin).href);
  }

  async function onDisconnect() {
    if (!account) return;
    const ok = await confirm({
      description: t("channel.disconnectConfirm", { email: account.email }),
      confirmLabel: t("channel.disconnect"),
      variant: "danger",
    });
    if (!ok) return;
    start(async () => {
      const r = await disconnectMicrosoftAccount();
      if (r.ok) toast(t("channel.disconnected"));
      else toast(t("error.unknown"), { variant: "error" });
      router.refresh();
    });
  }

  if (!account) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
        <p className="text-sm font-medium">{t("channel.noneTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("channel.noneBody")}</p>
        <p className="text-xs text-muted-foreground">{t("channel.consentNote")}</p>
        <div>
          <a href={CONNECT_URL} className={buttonVariants()}>
            {t("channel.connect")}
          </a>
        </div>
      </div>
    );
  }

  if (account.status === "NEEDS_RECONNECT") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        <p className="text-sm font-medium">{t("channel.reconnectTitle", { email: account.email })}</p>
        <p className="text-sm">{t("channel.reconnectBody")}</p>
        <div>
          <a href={CONNECT_URL} className={buttonVariants()}>
            {t("channel.reconnect")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{account.displayName ?? account.email}</p>
          <p className="truncate text-sm text-muted-foreground">{account.email}</p>
        </div>
        <span className="ml-auto rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
          {t("channel.connected")}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="rounded-full border border-border bg-card px-2.5 py-1">
          {account.accountKind === "personal" ? t("channel.kindPersonal") : t("channel.kindWork")}
        </span>
        <span className="rounded-full border border-border bg-card px-2.5 py-1">
          {t("channel.dailyLimit", { count: format.number(account.dailyLimit) })}
        </span>
        <span className="rounded-full border border-border bg-card px-2.5 py-1">
          {t("channel.sent24h", { count: format.number(account.sentLast24h) })}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {action}
        <Button type="button" variant="outline" disabled={busy} onClick={onSwitch}>
          {t("channel.switch")}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onDisconnect}>
          {t("channel.disconnect")}
        </Button>
      </div>
    </div>
  );
}
