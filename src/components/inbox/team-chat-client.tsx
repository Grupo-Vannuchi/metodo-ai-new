"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Users,
  Search,
  SendHorizontal,
  Paperclip,
  Reply,
  FileText,
  Download,
  LogOut,
  Plus,
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
  Smile,
  Bold,
  Italic,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { usePrompt } from "@/components/ui/prompt";
import { Avatar } from "@/components/app/avatar";
import { Spinner } from "@/components/ui/spinner";
import { formatBRL } from "@/lib/money";
import {
  sendTeamMessage,
  markTeamChatRead,
  reactToTeamMessage,
  editTeamMessage,
  deleteTeamMessage,
  pinTeamMessage,
  createChannel,
  leaveChannel,
} from "@/app/actions/team-chat";
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
  ChannelInfo,
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
  fileUrl?: string | null;
  fileName?: string | null;
  fileMime?: string | null;
  fileSize?: number | null;
  reactions?: { emoji: string; userId: string }[] | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  pinnedAt?: string | null;
  replyToId?: string | null;
  replyTo?: { id: string; senderId: string; body: string; deletedAt: string | null } | null;
  createdAt: string;
};

const TEAM_EMOJIS = ["👍", "❤️", "😂", "🎉", "✅", "🙏"];
/** Emoji palette for the composer picker. */
const EMOJI_PICKER = [
  "😀", "😄", "😅", "😂", "🙂", "😉", "😍", "😘", "😎", "🤩",
  "🤔", "😐", "😴", "😢", "😭", "😡", "😱", "🤯", "🥳", "🤝",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "✅", "❌", "⚠️", "🔥",
  "💡", "⭐", "❤️", "🎉", "🚀", "📌", "📎", "📅", "💰", "☕",
];

/**
 * Render a message body with lightweight formatting: **bold**, _italic_,
 * ~~strike~~ and `code`. Optionally highlights a search term. Kept simple and
 * safe (no HTML) — it tokenizes plain text into styled spans.
 */
function renderBody(text: string, term?: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_|~~[^~]+~~|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  const pushPlain = (s: string) => {
    if (!s) return;
    tokens.push(term ? highlight(s, term, key++) : s);
  };
  while ((m = re.exec(text)) !== null) {
    pushPlain(text.slice(last, m.index));
    const tok = m[0];
    const inner = tok.slice(tok.startsWith("**") || tok.startsWith("~~") ? 2 : 1, tok.length - (tok.startsWith("**") || tok.startsWith("~~") ? 2 : 1));
    if (tok.startsWith("**")) tokens.push(<strong key={key++}>{term ? highlight(inner, term, key++) : inner}</strong>);
    else if (tok.startsWith("~~")) tokens.push(<s key={key++}>{term ? highlight(inner, term, key++) : inner}</s>);
    else if (tok.startsWith("`")) tokens.push(<code key={key++} className="rounded bg-black/10 px-1 py-0.5 text-[0.85em]">{inner}</code>);
    else tokens.push(<em key={key++}>{term ? highlight(inner, term, key++) : inner}</em>);
    last = re.lastIndex;
  }
  pushPlain(text.slice(last));
  return tokens;
}

/** Wrap occurrences of `term` (case-insensitive) in a highlight mark. */
function highlight(text: string, term: string, baseKey: number): React.ReactNode {
  const q = term.trim().toLowerCase();
  if (!q) return text;
  const out: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx < 0) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <mark key={`${baseKey}-${k++}`} className="rounded bg-amber-300/60 text-inherit">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return out;
}
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
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [memberInfo, setMemberInfo] = useState<TeamMemberInfo | null>(null);
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const tempIdRef = useRef(0);

  // Fase 5: message search, pinned, presence/typing, emoji picker.
  const [msgSearch, setMsgSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const typingRef = useRef(false);
  const typingResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Presence + typing heartbeat: refresh who's online and who's typing here.
  useEffect(() => {
    let active = true;
    const beat = async () => {
      try {
        const r = await fetch("/api/inbox/team-presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: selectedChatId, typing: typingRef.current }),
        });
        if (active && r.ok) {
          const d = (await r.json()) as { online?: string[]; typing?: string[] };
          setOnline(new Set(d.online ?? []));
          setTypingUsers(d.typing ?? []);
        }
      } catch {
        /* ignore */
      }
    };
    void beat();
    const id = setInterval(beat, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [selectedChatId]);

  // Mark "typing" on keystroke; auto-clear after a short idle.
  function onDraftChange(value: string) {
    setDraft(value);
    typingRef.current = true;
    if (typingResetRef.current) clearTimeout(typingResetRef.current);
    typingResetRef.current = setTimeout(() => {
      typingRef.current = false;
    }, 3000);
  }

  // Wrap the composer's current selection with formatting markers.
  function wrapSelection(before: string, after: string) {
    const el = composerRef.current;
    if (!el) return;
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const selected = draft.slice(start, end) || t("formatSample");
    const next = draft.slice(0, start) + before + selected + after + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + before.length;
      el.selectionEnd = start + before.length + selected.length;
    });
  }

  function insertEmoji(emoji: string) {
    const el = composerRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      if (el) el.selectionStart = el.selectionEnd = start + emoji.length;
    });
  }

  async function pinTeam(id: string, pin: boolean) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, pinnedAt: pin ? new Date().toISOString() : null } : m)));
    await pinTeamMessage(id, pin);
    void fetchMessages();
  }

  function jumpToMessage(id: string) {
    const el = document.getElementById(`tm-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-brand");
      setTimeout(() => el.classList.remove("ring-2", "ring-brand"), 1600);
    }
  }

  function selectUser(userId: string) {
    setSelectedUserId(userId);
    const existing = chats.find((c) => c.otherUserId === userId);
    setSelectedChatId(existing?.id ?? null);
    if (!existing) setMessages([]);
  }

  // Open a group channel (chatId-based, no single "other user").
  function selectChannel(chatId: string) {
    setSelectedUserId(null);
    setSelectedChatId(chatId);
    setMessages([]);
  }

  const selectedChat = chats.find((c) => c.id === selectedChatId) ?? null;
  const channels = chats.filter((c) => c.isGroup);

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

  // Fase 5 derived: pinned messages, search results, and typing names.
  const pinned = messages.filter((m) => m.pinnedAt && !m.deletedAt);
  const searchTerm = msgSearch.trim().toLowerCase();
  const visibleMessages = searchTerm ? messages.filter((m) => (m.body ?? "").toLowerCase().includes(searchTerm)) : messages;
  const typingNames = typingUsers
    .map((id) => members.find((mm) => mm.userId === id)?.name)
    .filter((n): n is string => Boolean(n));

  async function onSend(e?: React.FormEvent) {
    e?.preventDefault();
    typingRef.current = false;
    const body = draft.trim();
    if (!body || sending) return;

    // Editing an existing message instead of sending a new one.
    if (editingId) {
      const id = editingId;
      setEditingId(null);
      setDraft("");
      const r = await editTeamMessage(id, body);
      if (r.ok) void fetchMessages();
      return;
    }

    if (!selectedUserId && !selectedChatId) return;
    setSending(true);
    setDraft("");
    const replyId = replyTo?.id;
    setReplyTo(null);
    const tempId = `temp-${tempIdRef.current++}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, senderId: currentUserId, body, attachmentType: null, attachmentId: null, attachmentLabel: null, attachmentHref: null, createdAt: "" },
    ]);
    const res = await sendTeamMessage({ chatId: selectedChatId ?? undefined, targetUserId: selectedUserId, body, replyToId: replyId });
    setSending(false);
    if (res.ok) {
      if (res.chatId !== selectedChatId) setSelectedChatId(res.chatId);
      else void fetchMessages();
      void fetchChats();
    }
  }

  // Send a file (image/document) in the team chat.
  async function onSendFile(file: File) {
    if ((!selectedUserId && !selectedChatId) || uploading) return;
    setUploading(true);
    const body = draft.trim();
    setDraft("");
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (selectedChatId) fd.set("chatId", selectedChatId);
      if (selectedUserId) fd.set("targetUserId", selectedUserId);
      if (body) fd.set("body", body);
      const r = await fetch("/api/inbox/team-messages/media", { method: "POST", body: fd });
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; chatId?: string };
      if (r.ok && data.ok) {
        if (data.chatId && data.chatId !== selectedChatId) setSelectedChatId(data.chatId);
        else void fetchMessages();
        void fetchChats();
      }
    } catch {
      /* ignore */
    } finally {
      setUploading(false);
    }
  }

  // Toggle my emoji reaction on a message (optimistic).
  async function reactTeam(messageId: string, emoji: string) {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const rest = (m.reactions ?? []).filter((r) => r.userId !== currentUserId);
        const mine = (m.reactions ?? []).find((r) => r.userId === currentUserId);
        return mine?.emoji === emoji ? { ...m, reactions: rest } : { ...m, reactions: [...rest, { emoji, userId: currentUserId }] };
      }),
    );
    const r = await reactToTeamMessage(messageId, emoji);
    if (r.ok) void fetchMessages();
  }

  // Soft-delete my own message.
  async function removeTeam(messageId: string) {
    if (!(await confirm({ description: t("deleteConfirm"), confirmLabel: t("delete"), variant: "danger" }))) return;
    const r = await deleteTeamMessage(messageId);
    if (r.ok) void fetchMessages();
  }

  async function leaveTeamChannel(chatId: string) {
    if (!(await confirm({ description: t("leaveConfirm"), confirmLabel: t("leaveChannel"), variant: "danger" }))) return;
    const r = await leaveChannel(chatId);
    if (r.ok) {
      setSelectedChatId(null);
      setSelectedUserId(null);
      void fetchChats();
    }
  }

  async function submitChannel(name: string, memberIds: string[]) {
    const r = await createChannel({ name, memberIds });
    if (r.ok) {
      setCreatingChannel(false);
      await fetchChats();
      selectChannel(r.chatId);
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

  // Channel info panel — load the channel's members when opened.
  const isGroupOpen = selectedChat?.isGroup ?? false;
  useEffect(() => {
    if (!showInfo || !isGroupOpen || !selectedChatId) return;
    let active = true;
    const run = async () => {
      try {
        const r = await fetch(`/api/inbox/channel-info?chatId=${selectedChatId}`, { cache: "no-store" });
        if (active && r.ok) setChannelInfo(await r.json());
      } catch {
        /* ignore */
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [showInfo, isGroupOpen, selectedChatId]);

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
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCreatingChannel(true)}
                title={t("newChannel")}
                aria-label={t("newChannel")}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-4" />
              </button>
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
              {channels.length > 0 ? (
                <div>
                  <div className="border-b border-border bg-muted/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("channels")}
                  </div>
                  {channels.map((c) => {
                    const active = c.id === selectedChatId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectChannel(c.id)}
                        className={cn(
                          "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors",
                          active ? "bg-brand/10" : "hover:bg-muted",
                        )}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                          <Users className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">{c.name}</span>
                            {c.unreadCount > 0 ? (
                              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-medium text-brand-foreground">
                                {c.unreadCount}
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.lastMessagePreview ?? t("memberCount", { count: c.memberCount })}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
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
          selectedUserId || selectedChatId ? "flex" : "hidden md:flex",
        )}
      >
        {(selectedUserId && activeUser) || selectedChat?.isGroup ? (
          <>
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedUserId(null);
                  setSelectedChatId(null);
                }}
                className="text-muted-foreground hover:text-foreground md:hidden"
                aria-label={t("back")}
              >
                <ArrowLeft className="size-5" />
              </button>
              {selectedChat?.isGroup ? (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <Users className="size-4" />
                </span>
              ) : (
                <span className="relative shrink-0">
                  <Avatar name={activeUser?.name ?? ""} src={activeUser?.avatarUrl} className="size-9" />
                  {activeUser && online.has(activeUser.userId) ? (
                    <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-green-500" aria-label={t("online")} />
                  ) : null}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{selectedChat?.isGroup ? selectedChat.name : activeUser?.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {selectedChat?.isGroup
                    ? t("memberCount", { count: selectedChat.memberCount })
                    : activeUser && online.has(activeUser.userId)
                      ? t("online")
                      : activeUser?.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSearchOpen((v) => !v)}
                title={t("searchMessages")}
                aria-label={t("searchMessages")}
                className={cn(
                  "rounded-lg p-1.5 transition-colors hover:bg-muted hover:text-foreground",
                  searchOpen ? "text-brand" : "text-muted-foreground",
                )}
              >
                <Search className="size-4" />
              </button>
              {selectedChat?.isGroup ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowInfo((v) => !v)}
                    title={t("channelInfo")}
                    aria-label={t("channelInfo")}
                    className={cn(
                      "rounded-lg p-1.5 transition-colors hover:bg-muted hover:text-foreground",
                      showInfo ? "text-brand" : "text-muted-foreground",
                    )}
                  >
                    <Info className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void leaveTeamChannel(selectedChat.id)}
                    title={t("leaveChannel")}
                    aria-label={t("leaveChannel")}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
                  >
                    <LogOut className="size-4" />
                  </button>
                </>
              ) : (
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
              )}
            </header>

            {searchOpen ? (
              <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-2">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={msgSearch}
                  onChange={(e) => setMsgSearch(e.target.value)}
                  placeholder={t("searchMessages")}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
                {msgSearch.trim() ? (
                  <span className="shrink-0 text-xs text-muted-foreground">{t("matches", { count: visibleMessages.length })}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    setMsgSearch("");
                  }}
                  aria-label={t("cancel")}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : null}

            {pinned.length > 0 && !searchTerm ? (
              <div className="flex flex-col gap-1 border-b border-border bg-brand/5 px-3 py-2">
                {pinned.map((pm) => (
                  <div key={pm.id} className="flex items-center gap-2 text-xs">
                    <Pin className="size-3.5 shrink-0 text-brand" />
                    <button
                      type="button"
                      onClick={() => jumpToMessage(pm.id)}
                      className="min-w-0 flex-1 truncate text-left text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {pm.body || t("fileLabel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void pinTeam(pm.id, false)}
                      aria-label={t("unpin")}
                      title={t("unpin")}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <PinOff className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto bg-muted/20 p-4">
              {messages.length === 0 ? (
                <p className="m-auto text-sm text-muted-foreground">
                  {t("start", { name: selectedChat?.isGroup ? (selectedChat.name ?? "") : (activeUser?.name ?? "") })}
                </p>
              ) : visibleMessages.length === 0 ? (
                <p className="m-auto text-sm text-muted-foreground">{t("noMatches")}</p>
              ) : (
                visibleMessages.map((msg) => {
                  const out = msg.senderId === currentUserId;
                  const deleted = Boolean(msg.deletedAt);
                  const reactions = msg.reactions ?? [];
                  return (
                    <div
                      key={msg.id}
                      id={`tm-${msg.id}`}
                      className={cn(
                        "group/tm flex max-w-[75%] flex-col gap-1 rounded-2xl transition-shadow",
                        out ? "items-end self-end" : "items-start self-start",
                      )}
                    >
                      <div className="relative">
                        <div
                          className={cn(
                            "rounded-2xl px-3 py-2 text-sm shadow-sm",
                            out ? "bg-brand text-brand-foreground" : "bg-card",
                          )}
                        >
                          {deleted ? (
                            <p className="italic opacity-70">{t("deletedMessage")}</p>
                          ) : (
                            <>
                              {msg.replyTo ? (
                                <div
                                  className={cn(
                                    "mb-1 rounded-md border-l-2 px-2 py-1 text-xs",
                                    out ? "border-brand-foreground/50 bg-black/10" : "border-brand/60 bg-muted",
                                  )}
                                >
                                  <p className="line-clamp-2 opacity-80">
                                    {msg.replyTo.deletedAt ? t("deletedMessage") : msg.replyTo.body || t("fileLabel")}
                                  </p>
                                </div>
                              ) : null}
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
                              {msg.fileUrl ? (
                                msg.fileMime?.startsWith("image/") ? (
                                  <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className="mb-1 block">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={msg.fileUrl} alt={msg.fileName ?? ""} loading="lazy" className="max-h-64 rounded-lg object-cover" />
                                  </a>
                                ) : (
                                  <a
                                    href={msg.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download={msg.fileName ?? undefined}
                                    className={cn(
                                      "mb-1 flex items-center gap-2 rounded-lg p-2 transition-colors",
                                      out ? "bg-brand-foreground/15 hover:bg-brand-foreground/25" : "bg-muted hover:bg-muted/70",
                                    )}
                                  >
                                    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", out ? "bg-brand-foreground/20" : "bg-brand/10 text-brand")}>
                                      <FileText className="size-4" />
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{msg.fileName}</span>
                                    <Download className="size-4 shrink-0 opacity-70" />
                                  </a>
                                )
                              ) : null}
                              {msg.body ? (
                                <p className="whitespace-pre-wrap break-words">{renderBody(msg.body, searchTerm || undefined)}</p>
                              ) : null}
                              {msg.createdAt ? (
                                <span
                                  className={cn(
                                    "mt-1 flex items-center justify-end gap-1 text-[10px]",
                                    out ? "text-brand-foreground/70" : "text-muted-foreground",
                                  )}
                                >
                                  {msg.pinnedAt ? <Pin className="size-2.5" /> : null}
                                  {msg.editedAt ? <span>{t("edited")}</span> : null}
                                  {fmtTime(msg.createdAt)}
                                </span>
                              ) : null}
                            </>
                          )}
                        </div>

                        {!deleted && msg.createdAt ? (
                          <div
                            className={cn(
                              "absolute -top-7 z-10 hidden items-center gap-0.5 rounded-full border border-border bg-card px-1 py-0.5 shadow-md group-hover/tm:flex",
                              out ? "right-0" : "left-0",
                            )}
                          >
                            {TEAM_EMOJIS.map((e) => (
                              <button
                                key={e}
                                type="button"
                                onClick={() => void reactTeam(msg.id, e)}
                                aria-label={e}
                                className="rounded-full px-0.5 text-base leading-none transition-transform hover:scale-125"
                              >
                                {e}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                setReplyTo(msg);
                                setEditingId(null);
                                composerRef.current?.focus();
                              }}
                              title={t("reply")}
                              aria-label={t("reply")}
                              className="rounded-full px-0.5 text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <Reply className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void pinTeam(msg.id, !msg.pinnedAt)}
                              title={msg.pinnedAt ? t("unpin") : t("pin")}
                              aria-label={msg.pinnedAt ? t("unpin") : t("pin")}
                              className={cn("rounded-full px-0.5 transition-colors hover:text-foreground", msg.pinnedAt ? "text-brand" : "text-muted-foreground")}
                            >
                              {msg.pinnedAt ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                            </button>
                            {out && msg.body ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(msg.id);
                                  setReplyTo(null);
                                  setDraft(msg.body);
                                  composerRef.current?.focus();
                                }}
                                title={t("edit")}
                                aria-label={t("edit")}
                                className="rounded-full px-0.5 text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <Pencil className="size-4" />
                              </button>
                            ) : null}
                            {out ? (
                              <button
                                type="button"
                                onClick={() => void removeTeam(msg.id)}
                                title={t("delete")}
                                aria-label={t("delete")}
                                className="rounded-full px-0.5 text-muted-foreground transition-colors hover:text-red-600"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      {reactions.length > 0 ? (
                        <div className="flex flex-wrap gap-0.5 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs shadow-sm">
                          {reactions.map((r, i) => (
                            <span key={i}>{r.emoji}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
              {typingNames.length > 0 && !searchTerm ? (
                <div className="flex items-center gap-2 self-start rounded-2xl bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm">
                  <span className="flex gap-0.5">
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                  </span>
                  {typingNames.length === 1 ? t("typingOne", { name: typingNames[0] }) : t("typingMany", { count: typingNames.length })}
                </div>
              ) : null}
            </div>

            {replyTo || editingId ? (
              <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-3 pt-2">
                <div className="min-w-0 flex-1 rounded-md border-l-2 border-brand px-2 py-1 text-xs">
                  <p className="font-semibold text-brand">{editingId ? t("editing") : t("replyingTo")}</p>
                  {!editingId && replyTo ? (
                    <p className="truncate text-muted-foreground">{replyTo.body || t("fileLabel")}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReplyTo(null);
                    setEditingId(null);
                    setDraft("");
                  }}
                  aria-label={t("cancel")}
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : null}

            <form onSubmit={onSend} className={cn("flex items-end gap-2 p-3", replyTo || editingId ? null : "border-t border-border")}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onSendFile(f);
                }}
              />
              <button
                type="button"
                onClick={() => setAttachOpen(true)}
                title={t("attach")}
                aria-label={t("attach")}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <FileText className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title={t("attachFile")}
                aria-label={t("attachFile")}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {uploading ? <Spinner className="size-4" /> : <Paperclip className="size-4" />}
              </button>
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setEmojiOpen((v) => !v)}
                  title={t("emoji")}
                  aria-label={t("emoji")}
                  className={cn(
                    "inline-flex size-10 items-center justify-center rounded-lg border border-border bg-muted/50 transition-colors hover:bg-muted hover:text-foreground",
                    emojiOpen ? "text-brand" : "text-muted-foreground",
                  )}
                >
                  <Smile className="size-4" />
                </button>
                {emojiOpen ? (
                  <>
                    <button type="button" aria-hidden tabIndex={-1} onClick={() => setEmojiOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                    <div className="glass-strong absolute bottom-12 left-0 z-50 grid w-64 grid-cols-8 gap-1 rounded-xl border border-border p-2 shadow-xl">
                      {EMOJI_PICKER.map((e) => (
                        <button key={e} type="button" onClick={() => insertEmoji(e)} className="rounded-md p-1 text-lg leading-none transition-transform hover:scale-125">
                          {e}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => wrapSelection("**", "**")}
                title={t("bold")}
                aria-label={t("bold")}
                className="hidden size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
              >
                <Bold className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => wrapSelection("_", "_")}
                title={t("italic")}
                aria-label={t("italic")}
                className="hidden size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
              >
                <Italic className="size-4" />
              </button>
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
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

      {/* Channel info panel */}
      {showInfo && selectedChat?.isGroup ? (
        <aside className="hidden w-full flex-col border-border md:w-80 md:shrink-0 md:border-l lg:flex">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">{t("channelInfo")}</h2>
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
              <span className="flex size-16 items-center justify-center rounded-full bg-brand/10 text-brand">
                <Users className="size-7" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{selectedChat.name}</p>
                <p className="text-sm text-muted-foreground">{t("memberCount", { count: selectedChat.memberCount })}</p>
              </div>
            </div>

            {(() => {
              const info = channelInfo?.id === selectedChat.id ? channelInfo : null;
              const creator = info?.members.find((m) => m.userId === info.createdById);
              return creator ? (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {t("createdBy", { name: creator.userId === currentUserId ? t("you") : creator.name })}
                </p>
              ) : null;
            })()}

            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold">{t("members")}</h3>
              {channelInfo?.id === selectedChat.id ? (
                <ul className="flex flex-col gap-1.5">
                  {channelInfo.members.map((m) => {
                    const isMe = m.userId === currentUserId;
                    return (
                      <li key={m.userId}>
                        <button
                          type="button"
                          disabled={isMe}
                          onClick={() => selectUser(m.userId)}
                          title={isMe ? undefined : t("openChat")}
                          className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-left transition-colors enabled:hover:bg-muted disabled:cursor-default"
                        >
                          <Avatar name={m.name} src={m.avatarUrl} className="size-8" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1 text-sm font-medium">
                              <span className="truncate">{m.name}</span>
                              {isMe ? <span className="shrink-0 text-xs text-muted-foreground">({t("you")})</span> : null}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                          </span>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {t(`role.${m.role}`)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex justify-center py-4">
                  <Spinner className="size-5 text-muted-foreground" />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void leaveTeamChannel(selectedChat.id)}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-600/10"
            >
              <LogOut className="size-4" />
              {t("leaveChannel")}
            </button>
          </div>
        </aside>
      ) : null}

      {attachOpen ? <AttachPicker onPick={sendAttachment} onClose={() => setAttachOpen(false)} /> : null}
      {creatingChannel ? (
        <CreateChannelModal members={visible} onCreate={submitChannel} onClose={() => setCreatingChannel(false)} />
      ) : null}

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

/** Modal to create a group channel: name + pick members. */
function CreateChannelModal({
  members,
  onCreate,
  onClose,
}: {
  members: { userId: string; name: string; avatarUrl: string | null }[];
  onCreate: (name: string, memberIds: string[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("teamChat");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function submit() {
    if (!name.trim() || selected.size === 0 || busy) return;
    setBusy(true);
    await onCreate(name.trim(), [...selected]);
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label={t("cancel")} onClick={onClose} className="absolute inset-0 cursor-default bg-black/50" />
      <div className="relative flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl border border-border bg-card p-5 shadow-xl">
        <h2 className="mb-3 text-base font-semibold">{t("newChannel")}</h2>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("channelName")}
          maxLength={80}
          className="mb-3 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
        />
        <p className="mb-1 text-xs font-medium text-muted-foreground">{t("members")}</p>
        <div className="mb-4 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          {members.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{t("noResults")}</p>
          ) : (
            members.map((m) => (
              <label
                key={m.userId}
                className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0 hover:bg-muted"
              >
                <input type="checkbox" checked={selected.has(m.userId)} onChange={() => toggle(m.userId)} className="accent-brand" />
                <Avatar name={m.name} src={m.avatarUrl} className="size-6" />
                <span className="truncate">{m.name}</span>
              </label>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted">
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!name.trim() || selected.size === 0 || busy}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("createChannel")}
          </button>
        </div>
      </div>
    </div>
  );
}
