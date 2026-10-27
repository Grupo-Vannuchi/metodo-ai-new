"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, ExternalLink, Reply, Send } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { replyToInboxMessage, replyToSmtpInboxMessage } from "@/app/actions/email-inbox";
import { REPLY_MAX_CHARS, type MailboxChannel } from "@/lib/email-broadcast/microsoft/inbox-core";

/**
 * "Responder" under an open Inbox e-mail: a plain-text reply that leaves from
 * the connected mailbox in the same conversation. Keyed by message upstream,
 * so its state resets when another e-mail opens.
 */
export function InboxReply({
  channel,
  messageId,
  recipient,
  mailbox,
  webLink,
}: {
  channel: MailboxChannel;
  messageId: string;
  recipient: string;
  mailbox: string;
  webLink: string | null;
}) {
  const t = useTranslations("emailBroadcast.inbox");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  // SMTP only: the hand-over may have reached the server, so there is no second "Enviar" until the member checks Sent.
  const [uncertain, setUncertain] = useState(false);
  const smtp = channel === "smtp";
  const [busy, start] = useTransition();
  const empty = text.trim().length === 0;

  function onSend() {
    if (empty) return;
    start(async () => {
      const res = smtp ? await replyToSmtpInboxMessage(messageId, text) : await replyToInboxMessage(messageId, text);
      if (res.ok) {
        setSent(text.trim());
        setText("");
        setOpen(false);
        toast(t("replySent"));
      } else if (smtp && res.error === "uncertain") {
        setUncertain(true);
        setOpen(false);
      } else {
        toast(t(smtp ? `smtp.replyError.${res.error}` : `replyError.${res.error}`), { variant: "error" });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {sent ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-green-950 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Check aria-hidden="true" className="size-4" />
            {t("youReplied")}
          </p>
          <p className="whitespace-pre-line text-sm [overflow-wrap:anywhere]">{sent}</p>
          <p className="text-xs opacity-80">{t(smtp ? "smtp.replySentHint" : "replySentHint", { email: mailbox })}</p>
        </div>
      ) : null}

      {uncertain ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("smtp.replyError.uncertain")}
        </div>
      ) : open ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <Label htmlFor="inbox-reply" className="mb-0">
            {t("replyTo", { name: recipient })}
          </Label>
          <Textarea
            id="inbox-reply"
            autoFocus
            rows={6}
            readOnly={smtp && busy}
            value={text}
            maxLength={REPLY_MAX_CHARS}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("replyPlaceholder")}
          />
          <p className="text-xs text-muted-foreground">{t(smtp ? "smtp.replyHint" : "replyHint", { email: mailbox })}</p>
          {smtp && busy ? (
            <p role="status" className="text-xs font-medium text-brand">
              {t("smtp.sendingHint")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || empty} onClick={onSend}>
              <Send aria-hidden="true" className="size-4" />
              {busy ? t("sending") : t("send")}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setOpen(true)}>
            <Reply aria-hidden="true" className="size-4" />
            {t("reply")}
          </Button>
          {webLink ? (
            <a href={webLink} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
              <ExternalLink aria-hidden="true" className="size-4" />
              {t("openOutlook")}
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}
