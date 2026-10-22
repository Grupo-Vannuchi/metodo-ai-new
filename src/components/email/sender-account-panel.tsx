"use client";

import { useTransition, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { disconnectSenderAccount } from "@/app/actions/email-sender-accounts";
import type { SenderAccountView } from "@/lib/email-broadcast/types";

type Provider = "MICROSOFT" | "GOOGLE" | "SMTP";

/** Full navigation (not a client route): the API redirects to the provider. SMTP has no such redirect: its form is a page of ours. */
const CONNECT_URL = {
  MICROSOFT: "/api/email/microsoft/connect",
  GOOGLE: "/api/email/google/connect",
} as const;

/** The SMTP account's form: connect, edit and reconnect are the same page (it opens in the mode the account is in). */
const SMTP_FORM_HREF = "/app/email/smtp";

/** The i18n keys (under emailBroadcast.channel) that differ per provider; the rest is shared. */
const TEXT: Record<
  Provider,
  {
    noneBody: string;
    consentNote: string;
    connect: string;
    disconnectConfirm: string;
    disconnected: string;
    reconnectBody: string;
  }
> = {
  MICROSOFT: {
    noneBody: "noneBody",
    consentNote: "consentNote",
    connect: "connect",
    disconnectConfirm: "disconnectConfirm",
    disconnected: "disconnected",
    reconnectBody: "reconnectBody",
  },
  GOOGLE: {
    noneBody: "googleNoneBody",
    consentNote: "googleConsentNote",
    connect: "googleConnect",
    disconnectConfirm: "googleDisconnectConfirm",
    disconnected: "googleDisconnected",
    reconnectBody: "googleReconnectBody",
  },
  SMTP: {
    noneBody: "smtpNoneBody",
    consentNote: "smtpConsentNote",
    connect: "smtpConnect",
    disconnectConfirm: "smtpDisconnectConfirm",
    disconnected: "smtpDisconnected",
    reconnectBody: "smtpReconnectBody",
  },
};

/** What only the OAuth providers have: switching to another signed-in account, and the kind of mailbox. */
const OAUTH_TEXT = {
  MICROSOFT: { switchConfirm: "switchConfirm", kindPersonal: "kindPersonal", kindWork: "kindWork" },
  GOOGLE: { switchConfirm: "googleSwitchConfirm", kindPersonal: "googleKindPersonal", kindWork: "googleKindWork" },
} as const;

const CHIP = "rounded-full border border-border bg-card px-2.5 py-1";
/** The SMTP server's name is typed by the company and can be long: that chip alone is cut short instead of wrapping. */
const CHIP_CUT = `${CHIP} max-w-full truncate`;

/**
 * The company's sending account at one provider: connect (none), reconnect
 * (NEEDS_RECONNECT) or the connected mailbox with switch / disconnect.
 * Microsoft and Google go to the provider to connect and to switch; the SMTP
 * account has a form page instead, where it is also edited and reconnected
 * (so "Editar" takes the place of "Trocar conta").
 * `action` goes first in the connected mailbox's buttons.
 */
export function SenderAccountPanel({
  provider,
  account,
  action,
}: {
  provider: Provider;
  account: SenderAccountView | null;
  action?: ReactNode;
}) {
  const t = useTranslations("emailBroadcast");
  const format = useFormatter();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, start] = useTransition();
  const text = TEXT[provider];
  const oauth = provider === "SMTP" ? null : { connectUrl: CONNECT_URL[provider], ...OAUTH_TEXT[provider] };

  /** The button that starts (or starts over) the connection: to the provider, or to the SMTP form. */
  function connectButton(label: string) {
    return oauth ? (
      <a href={oauth.connectUrl} className={buttonVariants()}>
        {label}
      </a>
    ) : (
      <Link href={SMTP_FORM_HREF} className={buttonVariants()}>
        {label}
      </Link>
    );
  }

  async function onSwitch() {
    if (!account || !oauth) return;
    const ok = await confirm({
      description: t(`channel.${oauth.switchConfirm}`, { email: account.email }),
      confirmLabel: t("channel.switchConfirmLabel"),
    });
    if (ok) window.location.assign(new URL(oauth.connectUrl, window.location.origin).href);
  }

  async function onDisconnect() {
    if (!account) return;
    const ok = await confirm({
      description: t(`channel.${text.disconnectConfirm}`, { email: account.email }),
      confirmLabel: t("channel.disconnect"),
      variant: "danger",
    });
    if (!ok) return;
    start(async () => {
      const r = await disconnectSenderAccount(provider);
      if (r.ok) toast(t(`channel.${text.disconnected}`));
      else toast(t("error.unknown"), { variant: "error" });
      router.refresh();
    });
  }

  if (!account) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
        <p className="text-sm font-medium">{t("channel.noneTitle")}</p>
        <p className="text-sm text-muted-foreground">{t(`channel.${text.noneBody}`)}</p>
        <p className="text-xs text-muted-foreground">{t(`channel.${text.consentNote}`)}</p>
        <div>{connectButton(t(`channel.${text.connect}`))}</div>
      </div>
    );
  }

  if (account.status === "NEEDS_RECONNECT") {
    // An SMTP account with no server to show (host null) is one whose stored data can't be read: it wasn't the server
    // that refused the password, so its text doesn't say so.
    const unreadable = !oauth && account.host === null;
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        <p className="text-sm font-medium">{t("channel.reconnectTitle", { email: account.email })}</p>
        <p className="text-sm">{t(`channel.${unreadable ? "smtpReconnectUnreadableBody" : text.reconnectBody}`)}</p>
        <div>{connectButton(t("channel.reconnect"))}</div>
      </div>
    );
  }

  // What the chips say: the mailbox kind and an estimated day for Microsoft/Google; the server, the company's own
  // limits and what is left of today's for SMTP. The sent count is the same for all.
  const chips: { text: string; cut?: boolean }[] = [];
  if (oauth) {
    chips.push({
      text: account.accountKind === "personal" ? t(`channel.${oauth.kindPersonal}`) : t(`channel.${oauth.kindWork}`),
    });
    chips.push({ text: t("channel.dailyLimit", { count: format.number(account.dailyLimit) }) });
  } else {
    if (account.host) chips.push({ text: account.host, cut: true });
    if (account.hourlyLimit !== null) {
      chips.push({ text: t("channel.smtpHourly", { count: format.number(account.hourlyLimit) }) });
    }
    chips.push({ text: t("channel.smtpDaily", { count: format.number(account.dailyLimit) }) });
  }
  chips.push({ text: t("channel.sent24h", { count: format.number(account.sentLast24h) }) });
  if (!oauth) chips.push({ text: t("channel.smtpRemaining", { count: account.remaining }) });

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
        {chips.map((chip) => (
          <span key={chip.text} title={chip.cut ? chip.text : undefined} className={chip.cut ? CHIP_CUT : CHIP}>
            {chip.text}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {action}
        {oauth ? (
          <Button type="button" variant="outline" disabled={busy} onClick={onSwitch}>
            {t("channel.switch")}
          </Button>
        ) : (
          <Link href={SMTP_FORM_HREF} className={buttonVariants({ variant: "outline" })}>
            {t("channel.smtpEdit")}
          </Link>
        )}
        <Button type="button" variant="outline" disabled={busy} onClick={onDisconnect}>
          {t("channel.disconnect")}
        </Button>
      </div>
    </div>
  );
}
