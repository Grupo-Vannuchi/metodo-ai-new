"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  MessageCircle,
  Search,
  SendHorizontal,
  AlertCircle,
  Info,
  Building2,
  Mail,
  Phone,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  FolderPlus,
  Folder,
  FolderInput,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatBrPhone } from "@/lib/phone";
import { Link } from "@/i18n/navigation";
import { Spinner } from "@/components/ui/spinner";
import { useConfirm } from "@/components/ui/confirm";
import { usePrompt } from "@/components/ui/prompt";
import { Avatar } from "@/components/app/avatar";
import { useRealtime } from "@/components/app/realtime-provider";
import { MessageMedia, MEDIA_TYPES } from "@/components/inbox/message-media";
import {
  markConversationRead,
  sendMessage,
  pinConversation,
  renameConversation,
  deleteConversation,
  moveConversation,
  createConversationFolder,
  renameConversationFolder,
  deleteConversationFolder,
} from "@/app/actions/inbox";

type Folder = { id: string; name: string };

type Dateish = string | Date | null;

type ContactInfo = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  tags: string[];
  company: { id: string; name: string } | null;
  opportunities?: { id: string; title: string; value: number | null; stage: { name: string } }[];
};

type Conversation = {
  id: string;
  remoteJid: string;
  name: string | null;
  customName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Dateish;
  unreadCount: number;
  contactId: string | null;
  contactName: string | null;
  pinned: boolean;
  folderId: string | null;
};

type Menu = { x: number; y: number; conversationId: string };

type Message = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  status: string | null;
  timestamp: string | Date;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  mediaStatus?: string | null;
  mediaName?: string | null;
  mediaDurationSec?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
};

let tempSeq = 0;


const MENU_ITEM =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted";

function displayName(
  c: Pick<Conversation, "name" | "customName" | "remoteJid" | "contactName">,
): string {
  if (c.customName) return c.customName;
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
  initialFolders,
  initialSelectedId,
}: {
  initial: Conversation[];
  initialFolders: Folder[];
  initialSelectedId?: string | null;
}) {
  const t = useTranslations("inbox");
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [conversations, setConversations] = useState<Conversation[]>(initial);
  const [folders, setFolders] = useState<Folder[]>(initialFolders);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showContact, setShowContact] = useState(false);
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox/conversations", { cache: "no-store" });
      if (r.ok) setConversations(await r.json());
    } catch {
      /* keep current on transient failure */
    }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox/folders", { cache: "no-store" });
      if (r.ok) setFolders(await r.json());
    } catch {
      /* keep current on transient failure */
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!selectedId) return;
    try {
      const r = await fetch(`/api/inbox/messages?conversationId=${selectedId}`, { cache: "no-store" });
      if (r.ok) setMessages(await r.json());
    } catch {
      /* ignore */
    }
  }, [selectedId]);

  // Load + mark read when a conversation is opened (inline so setState stays
  // behind the await).
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const run = async () => {
      try {
        const r = await fetch(`/api/inbox/messages?conversationId=${selectedId}`, { cache: "no-store" });
        if (active && r.ok) setMessages(await r.json());
      } catch {
        /* ignore */
      }
    };
    void run();
    void markConversationRead(selectedId).then(() => loadConversations());
    return () => {
      active = false;
    };
  }, [selectedId, loadConversations]);

  // Pushed live: new inbound messages refresh the list and the open thread.
  useRealtime("inbox", () => {
    void loadConversations();
    void fetchMessages();
  });

  // While any media is still being fetched/stored, poll the thread until every
  // bubble flips to READY/FAILED — then stop (no idle polling).
  const hasPendingMedia = messages.some((m) => m.mediaStatus === "PENDING");
  useEffect(() => {
    if (!hasPendingMedia) return;
    const id = setInterval(() => void fetchMessages(), 3000);
    return () => clearInterval(id);
  }, [hasPendingMedia, fetchMessages]);

  function select(id: string | null) {
    setSelectedId(id);
    setDraft("");
    setSendError(null);
    setShowContact(false);
    setContactInfo(null);
  }

  // Load the contact side panel when opened.
  useEffect(() => {
    const contactId = conversations.find((c) => c.id === selectedId)?.contactId;
    if (!showContact || !contactId) return;
    let active = true;
    (async () => {
      try {
        const r = await fetch(`/api/inbox/contact?contactId=${contactId}`, { cache: "no-store" });
        if (active && r.ok) setContactInfo(await r.json());
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, [showContact, selectedId, conversations]);

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

  const searching = search.trim().length > 0;
  const menuConvo = menu ? conversations.find((c) => c.id === menu.conversationId) ?? null : null;

  function openMenu(e: React.MouseEvent, id: string) {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 244);
    const y = Math.min(e.clientY, window.innerHeight - 360);
    setMenu({ x, y, conversationId: id });
  }

  function toggleFolder(id: string) {
    setClosedFolders((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function onPin(c: Conversation) {
    setMenu(null);
    await pinConversation(c.id, !c.pinned);
    void loadConversations();
  }

  async function onRename(c: Conversation) {
    setMenu(null);
    const name = await prompt({
      title: t("renameTitle"),
      defaultValue: c.customName ?? "",
      placeholder: displayName(c),
    });
    if (name === null) return;
    await renameConversation(c.id, name);
    void loadConversations();
  }

  async function onDelete(c: Conversation) {
    setMenu(null);
    const ok = await confirm({
      description: t("deleteConfirm", { name: displayName(c) }),
      confirmLabel: t("delete"),
      variant: "danger",
    });
    if (!ok) return;
    await deleteConversation(c.id);
    if (selectedId === c.id) select(null);
    void loadConversations();
  }

  async function onMove(c: Conversation, folderId: string | null) {
    setMenu(null);
    await moveConversation(c.id, folderId);
    void loadConversations();
  }

  async function onMoveToNew(c: Conversation) {
    setMenu(null);
    const name = await prompt({ title: t("newFolderTitle"), placeholder: t("folderNamePlaceholder") });
    if (!name) return;
    const res = await createConversationFolder(name);
    if (res.ok && res.id) {
      await moveConversation(c.id, res.id);
      void loadFolders();
      void loadConversations();
    }
  }

  async function onNewFolder() {
    const name = await prompt({ title: t("newFolderTitle"), placeholder: t("folderNamePlaceholder") });
    if (!name) return;
    await createConversationFolder(name);
    void loadFolders();
  }

  async function onRenameFolder(f: Folder) {
    const name = await prompt({ title: t("renameFolderTitle"), defaultValue: f.name });
    if (!name) return;
    await renameConversationFolder(f.id, name);
    void loadFolders();
  }

  async function onDeleteFolder(f: Folder) {
    const ok = await confirm({
      description: t("deleteFolderConfirm", { name: f.name }),
      confirmLabel: t("delete"),
      variant: "danger",
    });
    if (!ok) return;
    await deleteConversationFolder(f.id);
    void loadFolders();
    void loadConversations();
  }

  /** A single conversation row in the list (called as a function, not a JSX component). */
  function convItem(c: Conversation) {
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => select(c.id)}
        onContextMenu={(e) => openMenu(e, c.id)}
        className={cn(
          "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted",
          selectedId === c.id ? "bg-muted" : "",
        )}
      >
        <Avatar name={displayName(c)} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
              {c.pinned ? <Pin className="size-3 shrink-0 text-brand" /> : null}
              <span className="truncate">{displayName(c)}</span>
            </p>
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
    );
  }

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
    <div className="flex h-full overflow-hidden rounded-xl border border-border bg-card">
      {/* Conversation list */}
      <aside
        className={cn(
          "w-full flex-col border-border md:flex md:w-80 md:shrink-0 md:border-r",
          selectedId ? "hidden md:flex" : "flex",
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
          {conversations.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : searching ? (
            filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{t("noResults")}</p>
            ) : (
              filtered.map(convItem)
            )
          ) : (
            <>
              {filtered.filter((c) => !c.folderId).map(convItem)}
              {folders.map((f) => {
                const items = filtered.filter((c) => c.folderId === f.id);
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
                    {!isClosed ? items.map(convItem) : null}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </aside>

      {/* Thread */}
      <section
        className={cn(
          "min-w-0 flex-1 flex-col",
          selectedId ? "flex" : "hidden md:flex",
          showContact && "hidden lg:flex" // Hide thread on medium screens if contact panel is open
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
                {selected.contactId ? (
                  <button
                    type="button"
                    onClick={() => setShowContact((v) => !v)}
                    title={t("contactInfo")}
                    aria-label={t("contactInfo")}
                    className={cn(
                      "rounded-lg p-1 transition-colors hover:bg-muted hover:text-foreground",
                      showContact ? "text-brand" : "",
                    )}
                  >
                    <Info className="size-4" />
                  </button>
                ) : null}
              </div>
            </header>

            <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto bg-muted/20 p-4">
              {messages.length === 0 ? (
                <p className="m-auto text-sm text-muted-foreground">{t("noMessages")}</p>
              ) : (
                messages.map((m) => {
                  const out = m.direction === "OUTBOUND";
                  const failed = m.status === "FAILED";
                  const isMedia = MEDIA_TYPES.has(m.type);
                  const bare = m.type === "STICKER"; // stickers render without bubble chrome
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "max-w-[75%] text-sm",
                        out ? "self-end" : "self-start",
                        bare
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
                      {isMedia ? <MessageMedia m={m} out={out} /> : null}
                      {isMedia ? (
                        m.body ? (
                          <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                        ) : null
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{m.body ?? ""}</p>
                      )}
                      <span
                        className={cn(
                          "mt-1 flex items-center justify-end gap-1 text-[10px]",
                          out && !failed && !bare ? "text-brand-foreground/70" : "text-muted-foreground",
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

      {/* CRM Context Right Sidebar */}
      {showContact && contactInfo ? (
        <aside className="w-full flex-col border-border md:w-80 md:shrink-0 md:border-l lg:flex">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">{t("contactInfo")}</h2>
            <button
              type="button"
              onClick={() => setShowContact(false)}
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            >
              <ArrowLeft className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="font-medium text-lg truncate">{contactInfo.name ?? (selected ? displayName(selected) : "")}</span>
              <Link href={`/app/contacts/${contactInfo.id}`} className="shrink-0 text-xs text-brand hover:underline">
                {t("viewContact")}
              </Link>
            </div>
            
            <div className="flex flex-col gap-2 text-sm text-muted-foreground mb-6">
              {contactInfo.company?.name ? (
                <p className="flex items-center gap-2">
                  <Building2 className="size-4 shrink-0" />
                  <span className="truncate">{contactInfo.company.name}</span>
                </p>
              ) : null}
              {contactInfo.phone ? (
                <p className="flex items-center gap-2">
                  <Phone className="size-4 shrink-0" />
                  {contactInfo.phone}
                </p>
              ) : null}
              {contactInfo.email ? (
                <p className="flex items-center gap-2">
                  <Mail className="size-4 shrink-0" />
                  <span className="truncate">{contactInfo.email}</span>
                </p>
              ) : null}
              {contactInfo.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-1">
                  {contactInfo.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Oportunidades Ativas</h3>
                <Link
                  href={`/app/crm/new?contactId=${contactInfo.id}${contactInfo.company?.id ? `&companyId=${contactInfo.company.id}` : ""}`}
                  className="text-xs font-medium text-brand hover:underline"
                >
                  + Nova
                </Link>
              </div>

              {contactInfo.opportunities && contactInfo.opportunities.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {contactInfo.opportunities.map((opp) => (
                    <div key={opp.id} className="rounded-lg border border-border bg-muted/20 p-3">
                      <p className="font-medium text-sm truncate">{opp.title}</p>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5">{opp.stage.name}</span>
                        {opp.value !== null ? (
                          <span className="font-medium text-foreground">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(opp.value)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Nenhuma oportunidade em andamento.</p>
              )}
            </div>
          </div>
        </aside>
      ) : null}

      {/* Right-click context menu for a conversation */}
      {menu && menuConvo
        ? createPortal(
            // Portal to <body> so `position: fixed` is anchored to the viewport
            // (clientX/clientY), immune to any transformed/filtered ancestor.
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
            <button type="button" onClick={() => void onPin(menuConvo)} className={MENU_ITEM}>
              {menuConvo.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
              {menuConvo.pinned ? t("unpin") : t("pin")}
            </button>
            <button type="button" onClick={() => void onRename(menuConvo)} className={MENU_ITEM}>
              <Pencil className="size-4" />
              {t("rename")}
            </button>

            <div className="my-1 border-t border-border" />
            <p className="px-3 py-1 text-xs font-medium text-muted-foreground">{t("moveTo")}</p>
            <div className="max-h-40 overflow-y-auto">
              {menuConvo.folderId ? (
                <button type="button" onClick={() => void onMove(menuConvo, null)} className={MENU_ITEM}>
                  <FolderInput className="size-4" />
                  {t("noFolder")}
                </button>
              ) : null}
              {folders
                .filter((f) => f.id !== menuConvo.folderId)
                .map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => void onMove(menuConvo, f.id)}
                    className={MENU_ITEM}
                  >
                    <Folder className="size-4 shrink-0" />
                    <span className="truncate">{f.name}</span>
                  </button>
                ))}
              <button type="button" onClick={() => void onMoveToNew(menuConvo)} className={MENU_ITEM}>
                <FolderPlus className="size-4" />
                {t("newFolderMove")}
              </button>
            </div>

            <div className="my-1 border-t border-border" />
            <button
              type="button"
              onClick={() => void onDelete(menuConvo)}
              className={cn(MENU_ITEM, "text-red-600")}
            >
              <Trash2 className="size-4" />
              {t("delete")}
            </button>
          </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
