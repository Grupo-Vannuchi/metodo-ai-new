"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileUp, LayoutTemplate, Loader2, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MessageItem } from "./types";

/** Tipos que o seletor de arquivo oferece — a regra de verdade é a do servidor (media-rules). */
const ACCEPT = [
  "image/jpeg",
  "image/png",
  "video/mp4",
  "video/3gpp",
  "audio/aac",
  "audio/amr",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
].join(",");

export function Composer({
  windowOpen,
  replyTo,
  onCancelReply,
  onSendText,
  onSendFile,
  onOpenTemplates,
}: {
  windowOpen: boolean;
  replyTo: MessageItem | null;
  onCancelReply: () => void;
  onSendText: (text: string) => Promise<boolean>;
  onSendFile: (file: File, caption: string) => Promise<boolean>;
  onOpenTemplates: () => void;
}) {
  const t = useTranslations("inboxOficial.inbox");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submitText() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      if (await onSendText(value)) setText("");
    } finally {
      setSending(false);
    }
  }

  async function submitFile() {
    if (!file || sending) return;
    setSending(true);
    try {
      if (await onSendFile(file, caption.trim())) {
        setFile(null);
        setCaption("");
      }
    } finally {
      setSending(false);
    }
  }

  if (!windowOpen) {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-border p-3">
        <p className="text-xs text-muted-foreground">{t("windowClosedHint")}</p>
        <Button type="button" size="sm" onClick={onOpenTemplates}>
          <LayoutTemplate className="size-4" />
          {t("sendTemplate")}
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t border-border p-3">
      {replyTo ? (
        <div className="mb-2 flex items-start justify-between gap-2 rounded-lg border-l-2 border-brand bg-muted/60 px-3 py-1.5 text-xs">
          <p className="line-clamp-2">
            <span className="font-semibold">{t("replyingTo")}: </span>
            {replyTo.body ?? t("media")}
          </p>
          <button type="button" onClick={onCancelReply} aria-label={t("cancelReply")} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {file ? (
        <div className="flex items-center gap-2">
          <FileUp className="size-4 shrink-0 text-muted-foreground" />
          <span className="max-w-[40%] truncate text-sm">{file.name}</span>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={t("captionPlaceholder")}
            maxLength={1024}
            className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setCaption("");
            }}
            aria-label={t("cancel")}
            className="rounded p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
          <Button type="button" size="sm" onClick={submitFile} disabled={sending} aria-label={t("send")}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title={t("attach")}
            aria-label={t("attach")}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <Paperclip className="size-5" />
          </button>
          <button
            type="button"
            onClick={onOpenTemplates}
            title={t("sendTemplate")}
            aria-label={t("sendTemplate")}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <LayoutTemplate className="size-5" />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submitText();
              }
            }}
            rows={1}
            maxLength={4096}
            placeholder={t("placeholder")}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
          />
          <Button type="button" size="sm" onClick={submitText} disabled={sending || !text.trim()} aria-label={t("send")}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}
