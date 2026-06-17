"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, CheckCheck, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatBrPhone } from "@/lib/phone";
import { markConversationRead } from "@/app/actions/inbox";

type Dateish = string | Date | null;

type Conversation = {
  id: string;
  remoteJid: string;
  name: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Dateish;
  unreadCount: number;
};

type Message = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  status: string | null;
  timestamp: string | Date;
};

const CONVERSATIONS_POLL_MS = 5000;
const MESSAGES_POLL_MS = 4000;

function displayName(c: Pick<Conversation, "name" | "remoteJid">): string {
  if (c.name) return c.name;
  const digits = c.remoteJid.split("@")[0] ?? "";
  return formatBrPhone(digits) || digits;
}

function fmtTime(value: string | Date | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function InboxClient({ initial }: { initial: Conversation[] }) {
  const t = useTranslations("inbox");
  const [conversations, setConversations] = useState<Conversation[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox/conversations", { cache: "no-store" });
      if (r.ok) setConversations(await r.json());
    } catch {
      /* keep current on transient failure */
    }
  }, []);

  // Poll the conversation list (interval callback → deferred setState).
  useEffect(() => {
    const i = setInterval(() => void loadConversations(), CONVERSATIONS_POLL_MS);
    return () => clearInterval(i);
  }, [loadConversations]);

  // Load + mark read + poll the open conversation.
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const fetchMessages = async () => {
      try {
        const r = await fetch(`/api/inbox/messages?conversationId=${selectedId}`, { cache: "no-store" });
        if (active && r.ok) setMessages(await r.json());
      } catch {
        /* ignore */
      }
    };
    void fetchMessages();
    void markConversationRead(selectedId).then(() => loadConversations());
    const i = setInterval(() => void fetchMessages(), MESSAGES_POLL_MS);
    return () => {
      active = false;
      clearInterval(i);
    };
  }, [selectedId, loadConversations]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100dvh-7rem)] overflow-hidden rounded-xl border border-border bg-card">
      {/* Conversation list */}
      <aside
        className={cn(
          "w-full flex-col border-border md:flex md:w-80 md:shrink-0 md:border-r",
          selectedId ? "hidden md:flex" : "flex",
        )}
      >
        <div className="border-b border-border px-4 py-3">
          <h1 className="font-semibold">{t("title")}</h1>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted",
                  selectedId === c.id ? "bg-muted" : "",
                )}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <MessageCircle className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{displayName(c)}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtTime(c.lastMessageAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-muted-foreground">{c.lastMessagePreview ?? ""}</p>
                    {c.unreadCount > 0 ? (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-medium text-brand-foreground">
                        {c.unreadCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Thread */}
      <section
        className={cn(
          "min-w-0 flex-1 flex-col",
          selectedId ? "flex" : "hidden md:flex",
        )}
      >
        {selected ? (
          <>
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-muted-foreground hover:text-foreground md:hidden"
                aria-label={t("back")}
              >
                <ArrowLeft className="size-5" />
              </button>
              <div className="min-w-0">
                <p className="truncate font-medium">{displayName(selected)}</p>
              </div>
            </header>

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-muted/20 p-4">
              {messages.length === 0 ? (
                <p className="m-auto text-sm text-muted-foreground">{t("noMessages")}</p>
              ) : (
                messages.map((m) => {
                  const out = m.direction === "OUTBOUND";
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                        out
                          ? "self-end bg-brand text-brand-foreground"
                          : "self-start bg-card",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body ?? ""}</p>
                      <span
                        className={cn(
                          "mt-1 flex items-center justify-end gap-1 text-[10px]",
                          out ? "text-brand-foreground/70" : "text-muted-foreground",
                        )}
                      >
                        {fmtTime(m.timestamp)}
                        {out && m.status === "READ" ? <CheckCheck className="size-3" /> : null}
                        {out && m.status === "DELIVERED" ? <CheckCheck className="size-3 opacity-70" /> : null}
                        {out && (m.status === "SENT" || m.status === "PENDING") ? <Check className="size-3 opacity-70" /> : null}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
              {t("readOnly")}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageCircle className="size-8" />
            <p className="text-sm">{t("selectConversation")}</p>
          </div>
        )}
      </section>
    </div>
  );
}
