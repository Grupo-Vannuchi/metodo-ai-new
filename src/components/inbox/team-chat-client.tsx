"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Users, Search, SendHorizontal, Paperclip, UserCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { sendTeamMessage, markTeamChatRead } from "@/app/actions/team-chat";
import { useRealtime } from "@/components/app/realtime-provider";
import type { TeamChatSummary } from "@/lib/queries/team-chat";

type Member = { userId: string; name: string; email: string; role: string };
type Message = {
  id: string;
  senderId: string;
  body: string;
  attachmentType: string | null;
  attachmentId: string | null;
  createdAt: string;
};

export function TeamChatClient({
  members,
  initialChats,
  initialSelectedId,
  currentUserId,
}: {
  members: Member[];
  initialChats: TeamChatSummary[];
  initialSelectedId: string | null;
  currentUserId: string;
}) {
  const t = useTranslations("teamChat");
  const [chats, setChats] = useState<TeamChatSummary[]>(initialChats);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(initialSelectedId);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    initialChats.find((c) => c.id === initialSelectedId)?.otherUserId ?? null,
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const tempIdRef = useRef(0);

  function selectUser(userId: string) {
    setSelectedUserId(userId);
    const existing = chats.find((c) => c.otherUserId === userId);
    setSelectedChatId(existing?.id ?? null);
    if (!existing) setMessages([]);
  }

  const fetchMessages = useCallback(async () => {
    if (!selectedChatId) return;
    try {
      const r = await fetch(`/api/inbox/team-messages?chatId=${selectedChatId}`, { cache: "no-store" });
      if (r.ok) setMessages(await r.json());
    } catch {
      /* ignore */
    }
  }, [selectedChatId]);

  const fetchChats = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox/team-chats", { cache: "no-store" });
      if (r.ok) setChats(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  // Load the thread when a chat is opened and mark it read (inline so setState
  // stays behind the await).
  useEffect(() => {
    if (!selectedChatId) return;
    let active = true;
    const run = async () => {
      try {
        const r = await fetch(`/api/inbox/team-messages?chatId=${selectedChatId}`, { cache: "no-store" });
        if (active && r.ok) setMessages(await r.json());
      } catch {
        /* ignore */
      }
    };
    void run();
    void markTeamChatRead(selectedChatId);
    return () => {
      active = false;
    };
  }, [selectedChatId]);

  // Pushed live: new messages refresh the open thread and the sidebar.
  useRealtime("teamChat", () => {
    void fetchMessages();
    void fetchChats();
  });

  // Keep the thread scrolled to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const activeUser = members.find((m) => m.userId === selectedUserId) ?? null;

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !selectedUserId) return;
    setDraft("");

    // Optimistic echo, reconciled by the next fetch.
    const tempId = `temp-${tempIdRef.current++}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, senderId: currentUserId, body, attachmentType: null, attachmentId: null, createdAt: "" },
    ]);

    const res = await sendTeamMessage({ chatId: selectedChatId ?? undefined, targetUserId: selectedUserId, body });
    if (res.ok) {
      if (res.chatId !== selectedChatId) setSelectedChatId(res.chatId);
      else void fetchMessages();
      void fetchChats();
    }
  }

  const term = search.toLowerCase();
  const filteredMembers = members.filter(
    (m) =>
      m.userId !== currentUserId &&
      (m.name.toLowerCase().includes(term) || m.email.toLowerCase().includes(term)),
  );

  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-border bg-card">
      <aside className="flex w-full flex-col border-border md:w-80 md:shrink-0 md:border-r">
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
          {filteredMembers.map((m) => {
            const chat = chats.find((c) => c.otherUserId === m.userId);
            const isSelected = selectedUserId === m.userId;
            const unread = chat?.unreadCount ?? 0;
            return (
              <button
                key={m.userId}
                type="button"
                onClick={() => selectUser(m.userId)}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted",
                  isSelected ? "bg-muted" : "",
                )}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <UserCircle className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-muted-foreground">{chat?.lastMessagePreview ?? m.email}</p>
                    {unread > 0 ? (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-medium text-brand-foreground">
                        {unread}
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {selectedUserId && activeUser ? (
          <>
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-3">
                <div className="flex size-8 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <UserCircle className="size-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{activeUser.name}</h2>
                  <p className="truncate text-xs text-muted-foreground">{activeUser.email}</p>
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                  <p className="text-sm">{t("start", { name: activeUser.name })}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {messages.map((msg) => {
                    const fromMe = msg.senderId === currentUserId;
                    return (
                      <div key={msg.id} className={cn("flex max-w-[75%]", fromMe ? "self-end" : "self-start")}>
                        <div className={cn("rounded-2xl px-4 py-2 text-sm", fromMe ? "bg-brand text-brand-foreground" : "bg-muted text-foreground")}>
                          {msg.attachmentType ? (
                            <div className="mb-2 flex items-center gap-2 rounded bg-background/20 p-2 text-xs font-semibold">
                              <Paperclip className="size-3" />
                              {t("attachment")}: {msg.attachmentType}
                            </div>
                          ) : null}
                          <p className="whitespace-pre-wrap">{msg.body}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-border p-4">
              <form onSubmit={onSend} className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("placeholder")}
                  className="flex-1 rounded-lg border border-border bg-card px-4 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label={t("send")}
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-50"
                >
                  <SendHorizontal className="size-4" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <Users className="mb-4 size-12 opacity-20" />
            <p>{t("pick")}</p>
          </div>
        )}
      </main>
    </div>
  );
}
