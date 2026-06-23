"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Users,
  Search,
  SendHorizontal,
  Paperclip,
  ArrowLeft,
  FolderPlus,
  Folder,
  FolderInput,
  ChevronRight,
  ChevronDown,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Info,
  CheckSquare,
  KanbanSquare,
  Contact as ContactIcon,
  Building2,
  Radar,
  Mail,
  Phone,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { usePrompt } from "@/components/ui/prompt";
import { Avatar } from "@/components/app/avatar";
import { Spinner } from "@/components/ui/spinner";
import { formatBRL } from "@/lib/money";
import { sendTeamMessage, markTeamChatRead } from "@/app/actions/team-chat";
import {
  createTeamFolder,
  renameTeamFolder,
  deleteTeamFolder,
  moveTeamMember,
  pinTeamMember,
} from "@/app/actions/team-folders";
import { AttachPicker } from "@/components/inbox/attach-picker";
import { useRealtime } from "@/components/app/realtime-provider";
import type {
  TeamChatSummary,
  TeamMember,
  TeamChatFolderRow,
  TeamMemberInfo,
  AttachKind,
} from "@/lib/queries/team-chat";

type Message = {
  id: string;
  senderId: string;
  body: string;
  attachmentType: string | null;
  attachmentId: string | null;
  attachmentLabel: string | null;
  attachmentHref: string | null;
  createdAt: string;
};
type Menu = { x: number; y: number; userId: string };

const MENU_ITEM =
  "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted";

const ATTACH_ICONS: Record<string, typeof CheckSquare> = {
  TASK: CheckSquare,
  OPP: KanbanSquare,
  CONTACT: ContactIcon,
  COMPANY: Building2,
  LEAD: Radar,
};

function fmtTime(value: string | Date | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TeamChatClient({
  members,
  folders,
  initialChats,
  initialSelectedId,
  currentUserId,
}: {
  members: TeamMember[];
  folders: TeamChatFolderRow[];
  initialChats: TeamChatSummary[];
  initialSelectedId: string | null;
  currentUserId: string;
}) {
  const t = useTranslations("teamChat");
  const router = useRouter();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const [chats, setChats] = useState<TeamChatSummary[]>(initialChats);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(initialSelectedId);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    initialChats.find((c) => c.id === initialSelectedId)?.otherUserId ?? null,
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [memberInfo, setMemberInfo] = useState<TeamMemberInfo | null>(null);

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

  // Load the thread when a chat is opened and mark it read.
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

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const activeUser = members.find((m) => m.userId === selectedUserId) ?? null;

  async function onSend(e?: React.FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !selectedUserId || sending) return;
    setSending(true);
    setDraft("");
    const tempId = `temp-${tempIdRef.current++}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, senderId: currentUserId, body, attachmentType: null, attachmentId: null, attachmentLabel: null, attachmentHref: null, createdAt: "" },
    ]);
    const res = await sendTeamMessage({ chatId: selectedChatId ?? undefined, targetUserId: selectedUserId, body });
    setSending(false);
    if (res.ok) {
      if (res.chatId !== selectedChatId) setSelectedChatId(res.chatId);
      else void fetchMessages();
      void fetchChats();
    }
  }

  // Share a CRM entity: sends a message carrying the attachment (with any draft).
  async function sendAttachment(type: AttachKind, id: string) {
    setAttachOpen(false);
    if (!selectedUserId) return;
    const body = draft.trim();
    setDraft("");
    const res = await sendTeamMessage({
      chatId: selectedChatId ?? undefined,
      targetUserId: selectedUserId,
      body: body || undefined,
      attachmentType: type,
      attachmentId: id,
    });
    if (res.ok) {
      if (res.chatId !== selectedChatId) setSelectedChatId(res.chatId);
      else void fetchMessages();
      void fetchChats();
    }
  }

  // Member info panel — load the selected member's profile + open work.
  useEffect(() => {
    if (!showInfo || !selectedUserId) return;
    let active = true;
    const run = async () => {
      try {
        const r = await fetch(`/api/inbox/team-member?userId=${selectedUserId}`, { cache: "no-store" });
        if (active && r.ok) setMemberInfo(await r.json());
      } catch {
        /* ignore */
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [showInfo, selectedUserId]);

  // ---- Folder + member organization (org-shared) ----------------------------
  function openMenu(e: React.MouseEvent, userId: string) {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 244);
    const y = Math.min(e.clientY, window.innerHeight - 300);
    setMenu({ x, y, userId });
  }

  function toggleFolder(id: string) {
    setClosedFolders((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function onPin(m: TeamMember) {
    setMenu(null);
    await pinTeamMember(m.userId, !m.teamPinned);
    router.refresh();
  }

  async function onMove(m: TeamMember, folderId: string | null) {
    setMenu(null);
    await moveTeamMember(m.userId, folderId);
    router.refresh();
  }

  async function onMoveToNew(m: TeamMember) {
    setMenu(null);
    const name = await prompt({ title: t("newFolderTitle"), placeholder: t("folderNamePlaceholder") });
    if (!name) return;
    const res = await createTeamFolder(name);
    if (res.ok && res.id) {
      await moveTeamMember(m.userId, res.id);
      router.refresh();
    }
  }

  async function onNewFolder() {
    const name = await prompt({ title: t("newFolderTitle"), placeholder: t("folderNamePlaceholder") });
    if (!name) return;
    await createTeamFolder(name);
    router.refresh();
  }

  async function onRenameFolder(f: TeamChatFolderRow) {
    const name = await prompt({ title: t("renameFolderTitle"), defaultValue: f.name });
    if (!name) return;
    await renameTeamFolder(f.id, name);
    router.refresh();
  }

  async function onDeleteFolder(f: TeamChatFolderRow) {
    const ok = await confirm({
      description: t("deleteFolderConfirm", { name: f.name }),
      confirmLabel: t("deleteFolder"),
      variant: "danger",
    });
    if (!ok) return;
    await deleteTeamFolder(f.id);
    router.refresh();
  }

  const term = search.toLowerCase();
  const searching = term.length > 0;
  const visible = members.filter((m) => m.userId !== currentUserId);
  const matches = (m: TeamMember) =>
    m.name.toLowerCase().includes(term) || m.email.toLowerCase().includes(term);

  /** A single member row in the sidebar. */
  function memberRow(m: TeamMember) {
    const chat = chats.find((c) => c.otherUserId === m.userId);
    const isSelected = selectedUserId === m.userId;
    const unread = chat?.unreadCount ?? 0;
    return (
      <button
        key={m.userId}
        type="button"
        onClick={() => selectUser(m.userId)}
        onContextMenu={(e) => openMenu(e, m.userId)}
        className={cn(
          "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted",
          isSelected ? "bg-muted" : "",
        )}
      >
        <Avatar name={m.name} src={m.avatarUrl} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
              {m.teamPinned ? <Pin className="size-3 shrink-0 text-brand" /> : null}
              <span className="truncate">{m.name}</span>
            </p>
            {chat?.lastMessageAt ? (
              <span className="shrink-0 text-xs text-muted-foreground">{fmtTime(chat.lastMessageAt)}</span>
            ) : null}
          </div>
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
  }

  const menuMember = menu ? members.find((m) => m.userId === menu.userId) ?? null : null;

  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-border bg-card">
      <aside
        className={cn(
          "w-full flex-col border-border md:flex md:w-80 md:shrink-0 md:border-r",
          selectedUserId ? "hidden md:flex" : "flex",
        )}
      >
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-semibold">{t("title")}</h1>
            <button
              type="button"
              onClick={onNewFolder}
              title={t("newFolder")}
              aria-label={t("newFolder")}
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <FolderPlus className="size-4" />
            </button>
          </div>
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
          {searching ? (
            visible.filter(matches).length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{t("noResults")}</p>
            ) : (
              visible.filter(matches).map(memberRow)
            )
          ) : (
            <>
              {visible.filter((m) => !m.teamFolderId).map(memberRow)}
              {folders.map((f) => {
                const items = visible.filter((m) => m.teamFolderId === f.id);
                const isClosed = closedFolders.has(f.id);
                return (
                  <div key={f.id}>
                    <div
                      onContextMenu={(e) => {
                        e.preventDefault();
                        void onRenameFolder(f);
                      }}
                      className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => toggleFolder(f.id)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold text-muted-foreground"
                      >
                        {isClosed ? (
                          <ChevronRight className="size-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="size-3.5 shrink-0" />
                        )}
                        <Folder className="size-3.5 shrink-0" />
                        <span className="truncate">{f.name}</span>
                        <span className="text-muted-foreground/70">({items.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void onRenameFolder(f)}
                        title={t("renameFolder")}
                        aria-label={t("renameFolder")}
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteFolder(f)}
                        title={t("deleteFolder")}
                        aria-label={t("deleteFolder")}
                        className="rounded p-0.5 text-muted-foreground hover:text-red-600"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    {!isClosed ? items.map(memberRow) : null}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </aside>

      <section
        className={cn(
          "min-w-0 flex-1 flex-col",
          selectedUserId ? "flex" : "hidden md:flex",
        )}
      >
        {selectedUserId && activeUser ? (
          <>
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <button
                type="button"
                onClick={() => setSelectedUserId(null)}
                className="text-muted-foreground hover:text-foreground md:hidden"
                aria-label={t("back")}
              >
                <ArrowLeft className="size-5" />
              </button>
              <Avatar name={activeUser.name} src={activeUser.avatarUrl} className="size-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{activeUser.name}</p>
                <p className="truncate text-xs text-muted-foreground">{activeUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowInfo((v) => !v)}
                title={t("info")}
                aria-label={t("info")}
                className={cn(
                  "rounded-lg p-1.5 transition-colors hover:bg-muted hover:text-foreground",
                  showInfo ? "text-brand" : "text-muted-foreground",
                )}
              >
                <Info className="size-4" />
              </button>
            </header>

            <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto bg-muted/20 p-4">
              {messages.length === 0 ? (
                <p className="m-auto text-sm text-muted-foreground">{t("start", { name: activeUser.name })}</p>
              ) : (
                messages.map((msg) => {
                  const out = msg.senderId === currentUserId;
                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                        out ? "self-end bg-brand text-brand-foreground" : "self-start bg-card",
                      )}
                    >
                      {msg.attachmentType && msg.attachmentHref ? (
                        (() => {
                          const Icon = ATTACH_ICONS[msg.attachmentType] ?? Paperclip;
                          return (
                            <Link
                              href={msg.attachmentHref}
                              className={cn(
                                "mb-1 flex items-center gap-2 rounded-lg p-2 transition-colors",
                                out ? "bg-brand-foreground/15 hover:bg-brand-foreground/25" : "bg-muted hover:bg-muted/70",
                              )}
                            >
                              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", out ? "bg-brand-foreground/20" : "bg-brand/10 text-brand")}>
                                <Icon className="size-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className={cn("block text-[10px] uppercase tracking-wide", out ? "text-brand-foreground/70" : "text-muted-foreground")}>
                                  {t(`attachType.${msg.attachmentType}`)}
                                </span>
                                <span className="block truncate text-sm font-medium">{msg.attachmentLabel}</span>
                              </span>
                            </Link>
                          );
                        })()
                      ) : null}
                      {msg.body ? <p className="whitespace-pre-wrap break-words">{msg.body}</p> : null}
                      {msg.createdAt ? (
                        <span
                          className={cn(
                            "mt-1 flex items-center justify-end text-[10px]",
                            out ? "text-brand-foreground/70" : "text-muted-foreground",
                          )}
                        >
                          {fmtTime(msg.createdAt)}
                        </span>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={onSend} className="flex items-end gap-2 border-t border-border p-3">
              <button
                type="button"
                onClick={() => setAttachOpen(true)}
                title={t("attach")}
                aria-label={t("attach")}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Paperclip className="size-4" />
              </button>
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
                placeholder={t("placeholder")}
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
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Users className="size-8" />
            <p className="text-sm">{t("pick")}</p>
          </div>
        )}
      </section>

      {/* Member info panel */}
      {showInfo && selectedUserId && activeUser ? (
        <aside className="hidden w-full flex-col border-border md:w-80 md:shrink-0 md:border-l lg:flex">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">{t("info")}</h2>
            <button
              type="button"
              onClick={() => setShowInfo(false)}
              aria-label={t("close")}
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <Avatar name={activeUser.name} src={activeUser.avatarUrl} className="size-16 text-lg" />
              <div className="min-w-0">
                <p className="truncate font-medium">{activeUser.name}</p>
                {memberInfo?.position ? <p className="truncate text-sm text-muted-foreground">{memberInfo.position}</p> : null}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <Mail className="size-4 shrink-0" />
                <span className="truncate">{activeUser.email}</span>
              </p>
              {memberInfo?.phone ? (
                <p className="flex items-center gap-2">
                  <Phone className="size-4 shrink-0" />
                  {memberInfo.phone}
                </p>
              ) : null}
            </div>

            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold">{t("memberTasks")}</h3>
              {memberInfo && memberInfo.tasks.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {memberInfo.tasks.map((task) => (
                    <li key={task.id}>
                      <Link
                        href={`/app/tasks/${task.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm transition-colors hover:bg-muted"
                      >
                        <span className="truncate">{task.title}</span>
                        {task.dueDate ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {new Date(task.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm italic text-muted-foreground">{t("noTasks")}</p>
              )}
            </div>

            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold">{t("memberOpps")}</h3>
              {memberInfo && memberInfo.opportunities.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {memberInfo.opportunities.map((opp) => (
                    <li key={opp.id}>
                      <Link
                        href={`/app/crm/${opp.id}`}
                        className="block rounded-lg border border-border bg-muted/20 p-3 text-sm transition-colors hover:bg-muted"
                      >
                        <p className="truncate font-medium">
                          {opp.code ? <span className="mr-1 text-xs tabular-nums text-muted-foreground">{opp.code}</span> : null}
                          {opp.title}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          {opp.stageName ? <span className="rounded-full bg-muted px-2 py-0.5">{opp.stageName}</span> : <span />}
                          <span className="font-medium text-foreground">{formatBRL(opp.value)}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm italic text-muted-foreground">{t("noOpps")}</p>
              )}
            </div>
          </div>
        </aside>
      ) : null}

      {attachOpen ? <AttachPicker onPick={sendAttachment} onClose={() => setAttachOpen(false)} /> : null}

      {menu && menuMember
        ? createPortal(
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu(null);
                }}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div
                style={{ left: menu.x, top: menu.y }}
                className="fixed z-50 w-60 overflow-hidden rounded-xl border border-border bg-card py-1 text-sm shadow-xl motion-safe:animate-dialog-in"
              >
                <button type="button" onClick={() => void onPin(menuMember)} className={MENU_ITEM}>
                  {menuMember.teamPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  {menuMember.teamPinned ? t("unpin") : t("pin")}
                </button>

                <div className="my-1 border-t border-border" />
                <p className="px-3 py-1 text-xs font-medium text-muted-foreground">{t("moveTo")}</p>
                <div className="max-h-40 overflow-y-auto">
                  {menuMember.teamFolderId ? (
                    <button type="button" onClick={() => void onMove(menuMember, null)} className={MENU_ITEM}>
                      <FolderInput className="size-4" />
                      {t("noFolder")}
                    </button>
                  ) : null}
                  {folders
                    .filter((f) => f.id !== menuMember.teamFolderId)
                    .map((f) => (
                      <button key={f.id} type="button" onClick={() => void onMove(menuMember, f.id)} className={MENU_ITEM}>
                        <Folder className="size-4 shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </button>
                    ))}
                  <button type="button" onClick={() => void onMoveToNew(menuMember)} className={MENU_ITEM}>
                    <FolderPlus className="size-4" />
                    {t("newFolderMove")}
                  </button>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
