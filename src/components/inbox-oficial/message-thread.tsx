"use client";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AlertCircle, Check, CheckCheck, Clock, CornerUpLeft, MapPin, SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageMedia, MEDIA_TYPES } from "@/components/inbox/message-media";
import { reactionsOf, type MessageItem } from "./types";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export function MessageThread({
  messages,
  onReply,
  onReact,
}: {
  messages: MessageItem[];
  onReply: (m: MessageItem) => void;
  onReact: (m: MessageItem, emoji: string) => void;
}) {
  const t = useTranslations("inboxOficial.inbox");
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;

  // Rola para o fim quando chega uma mensagem nova (ou ao abrir a conversa).
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-muted/20 text-sm text-muted-foreground">
        {t("noMessages")}
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-muted/20 p-4">
      {messages.map((m) => (
        <Bubble key={m.id} m={m} onReply={onReply} onReact={onReact} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function Bubble({
  m,
  onReply,
  onReact,
}: {
  m: MessageItem;
  onReply: (m: MessageItem) => void;
  onReact: (m: MessageItem, emoji: string) => void;
}) {
  const t = useTranslations("inboxOficial.inbox");
  const format = useFormatter();
  const [picking, setPicking] = useState(false);
  const out = m.direction === "OUTBOUND";
  const failed = m.status === "FAILED";
  const isMedia = MEDIA_TYPES.has(m.type);
  const reactions = reactionsOf(m.reactions);

  return (
    <div className={cn("group/msg flex max-w-[80%] flex-col gap-1", out ? "items-end self-end" : "items-start self-start")}>
      <div
        className={cn(
          "text-sm",
          m.type === "STICKER"
            ? null
            : cn(
                "rounded-2xl px-3 py-2 shadow-sm",
                out
                  ? failed
                    ? "border border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
                    : "bg-brand text-brand-foreground"
                  : "bg-card",
              ),
        )}
      >
        {m.type === "TEMPLATE" ? (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
            {t("templateBadge")}
            {m.templateName ? ` · ${m.templateName}` : ""}
          </p>
        ) : null}
        {m.quotedBody ? (
          <div
            className={cn(
              "mb-1 rounded-md border-l-2 px-2 py-1 text-xs",
              out ? "border-brand-foreground/50 bg-black/10" : "border-brand/60 bg-muted",
            )}
          >
            <p className="line-clamp-2 opacity-80">{m.quotedBody}</p>
          </div>
        ) : null}
        {isMedia ? <MessageMedia m={m} out={out} /> : null}
        {m.type === "LOCATION" ? (
          <p className="flex items-center gap-1.5">
            <MapPin className="size-4 shrink-0" />
            {m.body}
          </p>
        ) : m.type === "UNSUPPORTED" ? (
          <p className="italic opacity-70">{t("unsupportedMessage")}</p>
        ) : m.body ? (
          <p className={cn("whitespace-pre-wrap break-words", isMedia && "mt-1")}>{m.body}</p>
        ) : null}
        <p className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", out ? "opacity-80" : "text-muted-foreground")}>
          {format.dateTime(new Date(m.timestamp), { hour: "2-digit", minute: "2-digit" })}
          {out ? <StatusIcon status={m.status} error={m.errorMessage} failedLabel={t("failed")} /> : null}
        </p>
      </div>
      {reactions.length > 0 ? (
        <div className="-mt-2 flex gap-0.5 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs shadow-sm">
          {reactions.map((r, i) => (
            <span key={`${r.emoji}-${i}`}>{r.emoji}</span>
          ))}
        </div>
      ) : null}
      <div className="flex gap-1 transition-opacity sm:opacity-0 sm:group-hover/msg:opacity-100">
        <button
          type="button"
          onClick={() => onReply(m)}
          title={t("reply")}
          aria-label={t("reply")}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <CornerUpLeft className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          title={t("react")}
          aria-label={t("react")}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <SmilePlus className="size-3.5" />
        </button>
        {picking
          ? QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setPicking(false);
                  onReact(m, emoji);
                }}
                className="rounded px-1 text-sm hover:bg-muted"
              >
                {emoji}
              </button>
            ))
          : null}
      </div>
    </div>
  );
}

function StatusIcon({ status, error, failedLabel }: { status: string | null; error: string | null; failedLabel: string }) {
  if (status === "FAILED") {
    return (
      <span title={error ?? failedLabel} className="flex items-center gap-0.5">
        <AlertCircle className="size-3" />
        {failedLabel}
      </span>
    );
  }
  if (status === "READ") return <CheckCheck className="size-3.5 text-sky-300" />;
  if (status === "DELIVERED") return <CheckCheck className="size-3.5" />;
  if (status === "SENT") return <Check className="size-3.5" />;
  return <Clock className="size-3" />;
}
