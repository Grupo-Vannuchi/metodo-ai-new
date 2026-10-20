"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, ExternalLink, Reply, Send } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { replyToInboxMessage } from "@/app/actions/email-inbox";
import { REPLY_MAX_CHARS } from "@/lib/email-broadcast/microsoft/inbox-core";

/**
 * "Responder" under an open Inbox e-mail: a plain-text reply that leaves from
 * the connected mailbox in the same conversation. Keyed by message upstream,
 * so its state resets when another e-mail opens.
 */
export function InboxReply({
  messageId,
  recipient,
  mailbox,
  webLink,
}: {
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
  const [busy, start] = useTransition();
  const empty = text.trim().length === 0;

  function onSend() {
    if (empty) return;
    start(async () => {
      const res = await replyToInboxMessage(messageId, text);
      if (res.ok) {
        setSent(text.trim());
        setText("");
        setOpen(false);
        toast(t("replySent"));
      } else {
        toast(t(`replyError.${res.error}`), { variant: "error" });
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
          <p className="text-xs opacity-80">{t("replySentHint", { email: mailbox })}</p>
        </div>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <Label htmlFor="inbox-reply" className="mb-0">
            {t("replyTo", { name: recipient })}
          </Label>
          <Textarea
            id="inbox-reply"
            autoFocus
            rows={6}
            value={text}
            maxLength={REPLY_MAX_CHARS}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("replyPlaceholder")}
          />
          <p className="text-xs text-muted-foreground">{t("replyHint", { email: mailbox })}</p>
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
