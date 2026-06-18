"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCheck, MessageCircle, Search, SendHorizontal, AlertCircle, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatBrPhone } from "@/lib/phone";
import { Link } from "@/i18n/navigation";
import { Spinner } from "@/components/ui/spinner";
import { markConversationRead, sendMessage, assignConversation } from "@/app/actions/inbox";

type Dateish = string | Date | null;

type Member = { userId: string; name: string };

type Conversation = {
  id: string;
  remoteJid: string;
  name: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Dateish;
  unreadCount: number;
  contactId: string | null;
  contactName: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
};

type Message = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  status: string | null;
  timestamp: string | Date;
};

let tempSeq = 0;

const CONVERSATIONS_POLL_MS = 5000;
const MESSAGES_POLL_MS = 4000;

function displayName(c: Pick<Conversation, "name" | "remoteJid" | "contactName">): string {
  if (c.contactName) return c.contactName;
  if (c.name) return c.name;
  const digits = c.remoteJid.split("@")[0] ?? "";
  return formatBrPhone(digits) || digits;
}

function fmtTime(value: string | Date | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function InboxClient({
  initial,
  members,
  initialSelectedId,
}: {
  initial: Conversation[];
  members: Member[];
  initialSelectedId?: string | null;
}) {
  const t = useTranslations("inbox");
  const [conversations, setConversations] = useState<Conversation[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  function select(id: string | null) {
    setSelectedId(id);
    setDraft("");
    setSendError(null);
  }

  // Keep the thread scrolled to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const filtered = search.trim()
    ? conversations.filter((c) => {
        const q = search.trim().toLowerCase();
        return (
          displayName(c).toLowerCase().includes(q) ||
          (c.lastMessagePreview ?? "").toLowerCase().includes(q) ||
          c.remoteJid.toLowerCase().includes(q)
        );
      })
    : conversations;

  async function onSend(e?: React.FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !selectedId || sending) return;
    setSendError(null);
    setSending(true);
    setDraft("");
    const temp: Message = {
      id: `temp-${++tempSeq}`,
      direction: "OUTBOUND",
      type: "TEXT",
      body,
      status: "PENDING",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, temp]);

    const r = await sendMessage(selectedId, body);
    setSending(false);
    if (r.ok) {
      void loadConversations(); // the poll replaces the temp with the persisted message
    } else {
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? { ...m, status: "FAILED" } : m)));
      setSendError(t(`sendError.${r.error}`));
    }
  }

  return (
    <div className="flex h-[calc(100dvh-7rem)] overflow-hidden rounded-xl border border-border bg-card">
      {/* Conversation list */}
      <aside
        className={cn(
          "w-full flex-col border-border md:flex md:w-80 md:shrink-0 md:border-r",
          selectedId ? "hidden md:flex" : "flex",
        )}
      >
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <h1 className="font-semibold">{t("title")}</h1>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search")}
              className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm focus-visible:border-brand focus-visible:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("noResults")}</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => select(c.id)}
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
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => select(null)}
                  className="text-muted-foreground hover:text-foreground md:hidden"
                  aria-label={t("back")}
                >
                  <ArrowLeft className="size-5" />
                </button>
                <div className="min-w-0">
                  <p className="truncate font-medium">{displayName(selected)}</p>
                  {selected.contactId ? (
                    <Link
                      href={`/app/contacts/${selected.contactId}`}
                      className="text-xs text-brand hover:underline"
                    >
                      {t("viewContact")}
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <User className="size-4 shrink-0" />
                <select
                  value={selected.assignedToId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    void assignConversation(selected.id, v).then(() => loadConversations());
                  }}
                  title={t("assignTo")}
                  className="max-w-[10rem] rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground focus-visible:border-brand focus-visible:outline-none"
                >
                  <option value="">{t("unassigned")}</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>{m.name}</option>
                  ))}
                </select>
              </div>
            </header>

            <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto bg-muted/20 p-4">
              {messages.length === 0 ? (
                <p className="m-auto text-sm text-muted-foreground">{t("noMessages")}</p>
              ) : (
                messages.map((m) => {
                  const out = m.direction === "OUTBOUND";
                  const failed = m.status === "FAILED";
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                        out
                          ? failed
                            ? "self-end border border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
                            : "self-end bg-brand text-brand-foreground"
                          : "self-start bg-card",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body ?? ""}</p>
                      <span
                        className={cn(
                          "mt-1 flex items-center justify-end gap-1 text-[10px]",
                          out && !failed ? "text-brand-foreground/70" : "text-muted-foreground",
                        )}
                      >
                        {fmtTime(m.timestamp)}
                        {failed ? <AlertCircle className="size-3 text-red-500" /> : null}
                        {out && !failed && m.status === "READ" ? <CheckCheck className="size-3" /> : null}
                        {out && !failed && m.status === "DELIVERED" ? <CheckCheck className="size-3 opacity-70" /> : null}
                        {out && !failed && (m.status === "SENT" || m.status === "PENDING") ? <Check className="size-3 opacity-70" /> : null}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={onSend} className="flex items-end gap-2 border-t border-border p-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onSend();
                  }
                }}
                rows={1}
                placeholder={t("composerPlaceholder")}
                className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                aria-label={t("send")}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {sending ? <Spinner className="size-4" /> : <SendHorizontal className="size-4" />}
              </button>
            </form>
            {sendError ? (
              <p role="alert" className="px-4 pb-2 text-xs text-red-500">{sendError}</p>
            ) : null}
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
