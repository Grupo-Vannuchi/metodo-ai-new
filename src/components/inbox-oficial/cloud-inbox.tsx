"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, MessageCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { isWindowOpen } from "@/lib/whatsapp-cloud/window";
import type { CloudTemplateOption } from "@/lib/whatsapp-cloud/template-params";
import {
  markCloudConversationRead,
  reactCloudMessage,
  sendCloudText,
  type CloudActionResult,
} from "@/app/actions/inbox-oficial";
import { Avatar, ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { WindowBanner } from "./window-banner";
import { TemplatePicker } from "./template-picker";
import { NewConversationDialog } from "./new-conversation-dialog";
import { displayName, type ConversationItem, type MessageItem } from "./types";

const LIST_POLL_MS = 10_000;
const THREAD_POLL_MS = 4_000;
const CLOCK_MS = 30_000;
/** Mídia recebida ainda pendente depois disso é pedida sob demanda. */
const MEDIA_GRACE_MS = 15_000;

type Fail = Extract<CloudActionResult, { ok: false }>;

export function CloudInbox({
  initial,
  initialSelectedId,
  templates,
  numberProblem,
}: {
  initial: ConversationItem[];
  initialSelectedId: string | null;
  templates: CloudTemplateOption[];
  numberProblem: { status: "INACTIVE" | "ERROR"; error: string | null } | null;
}) {
  const t = useTranslations("inboxOficial");
  const toast = useToast();
  const [conversations, setConversations] = useState<ConversationItem[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const selectedRef = useRef<string | null>(initialSelectedId);
  const mediaTried = useRef(new Set<string>());

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const windowOpen = now !== null && !!selected && isWindowOpen(selected.lastInboundAt, new Date(now));
  const failText = useCallback((r: Fail) => t(`errors.${r.error}`, { detail: r.detail ?? "" }), [t]);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox-oficial/conversations", { cache: "no-store" });
      if (r.ok) setConversations((await r.json()) as ConversationItem[]);
    } catch {
      /* offline: tenta no próximo ciclo */
    }
  }, []);

  /** Pede sob demanda a mídia que continua pendente (ou falhou) — uma vez por mensagem. */
  const repairMedia = useCallback(async (list: MessageItem[]) => {
    const due = list.filter(
      (m) =>
        m.direction === "INBOUND" &&
        (m.mediaStatus === "FAILED" ||
          (m.mediaStatus === "PENDING" && Date.now() - new Date(m.timestamp).getTime() > MEDIA_GRACE_MS)) &&
        !mediaTried.current.has(m.id),
    );
    for (const m of due) {
      mediaTried.current.add(m.id);
      try {
        const r = await fetch("/api/inbox-oficial/media/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: m.id }),
        });
        if (!r.ok) continue;
        const media = (await r.json()) as Partial<MessageItem> | null;
        if (media) setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...media } : x)));
      } catch {
        /* fica para a próxima visita */
      }
    }
  }, []);

  const loadMessages = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/inbox-oficial/messages?conversationId=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!r.ok || selectedRef.current !== id) return;
        const data = (await r.json()) as MessageItem[];
        if (selectedRef.current !== id) return;
        setMessages(data);
        void repairMedia(data);
      } catch {
        /* offline */
      }
    },
    [repairMedia],
  );

  // Relógio da janela de 24h (setState só dentro dos timers).
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, CLOCK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => void loadConversations(), LIST_POLL_MS);
    return () => clearInterval(id);
  }, [loadConversations]);

  // Conversa aberta: carrega, marca como lida e atualiza periodicamente.
  // A carga inicial vai num timer (como o relógio acima) para não chamar
  // setState de forma síncrona dentro do corpo do efeito.
  useEffect(() => {
    if (!selectedId) return;
    const kickoff = setTimeout(() => {
      void loadMessages(selectedId);
      void markCloudConversationRead(selectedId).then(() => loadConversations());
    }, 0);
    const id = setInterval(() => void loadMessages(selectedId), THREAD_POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [selectedId, loadMessages, loadConversations]);

  function select(id: string | null) {
    setSelectedId(id);
    setMessages([]);
    setReplyTo(null);
  }

  async function sendText(text: string): Promise<boolean> {
    if (!selectedId) return false;
    const r = await sendCloudText(selectedId, text, replyTo?.id ?? null);
    if (!r.ok) {
      toast(failText(r), { variant: "error" });
      if (r.error === "window_closed") setPickerOpen(true);
      return false;
    }
    setReplyTo(null);
    await loadMessages(selectedId);
    void loadConversations();
    return true;
  }

  async function sendFile(file: File, caption: string): Promise<boolean> {
    if (!selectedId) return false;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("conversationId", selectedId);
    fd.append("caption", caption);
    const r = await fetch("/api/inbox-oficial/media/upload", { method: "POST", body: fd });
    const data = (await r.json().catch(() => ({ ok: false, error: "unknown" }))) as {
      ok: boolean;
      error?: string;
      detail?: string;
    };
    if (!data.ok) {
      toast(t(`errors.${data.error ?? "unknown"}`, { detail: data.detail ?? "" }), { variant: "error" });
      return false;
    }
    await loadMessages(selectedId);
    void loadConversations();
    return true;
  }

  async function react(m: MessageItem, emoji: string) {
    const r = await reactCloudMessage(m.id, emoji);
    if (!r.ok) toast(failText(r), { variant: "error" });
    else if (selectedId) await loadMessages(selectedId);
  }

  return (
    <div className="glass flex h-full overflow-hidden rounded-2xl border border-border shadow-sm">
      <ConversationList
        conversations={conversations}
        selectedId={selectedId}
        onSelect={select}
        onNew={() => setNewOpen(true)}
        className={selectedId ? "hidden sm:flex" : "flex"}
      />
      <section className={cn("min-w-0 flex-1 flex-col", selectedId ? "flex" : "hidden sm:flex")}>
        {numberProblem ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            {numberProblem.status === "INACTIVE"
              ? t("numberInactive")
              : t("numberError", { error: numberProblem.error ?? "" })}
            <Link href="/app/inbox-oficial?config=1" className="font-medium underline underline-offset-2">
              {t("fixInSettings")}
            </Link>
          </div>
        ) : null}
        {selected ? (
          <>
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <button
                type="button"
                onClick={() => select(null)}
                aria-label={t("inbox.back")}
                className="rounded p-1 text-muted-foreground hover:bg-muted sm:hidden"
              >
                <ArrowLeft className="size-4" />
              </button>
              <Avatar name={displayName(selected)} className="size-9" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{displayName(selected)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {selected.waId ? `+${selected.waId}` : selected.username ? `@${selected.username}` : ""}
                </p>
              </div>
            </header>
            <WindowBanner lastInboundAt={selected.lastInboundAt} now={now} />
            <MessageThread messages={messages} onReply={setReplyTo} onReact={react} />
            {numberProblem ? null : (
              <Composer
                windowOpen={windowOpen}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                onSendText={sendText}
                onSendFile={sendFile}
                onOpenTemplates={() => setPickerOpen(true)}
              />
            )}
          </>
        ) : (
          <div className="m-auto flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <MessageCircle className="size-8" />
            {t("inbox.selectConversation")}
          </div>
        )}
      </section>
      {selected ? (
        <TemplatePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          templates={templates}
          conversationId={selected.id}
          onSent={() => {
            setPickerOpen(false);
            void loadMessages(selected.id);
            void loadConversations();
          }}
        />
      ) : null}
      <NewConversationDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onStarted={(id) => {
          setNewOpen(false);
          void loadConversations().then(() => {
            select(id);
            setPickerOpen(true);
          });
        }}
      />
    </div>
  );
}
