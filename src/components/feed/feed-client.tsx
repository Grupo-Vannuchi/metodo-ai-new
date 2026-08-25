"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Send,
  Paperclip,
  AtSign,
  Trash2,
  X,
  CheckSquare,
  KanbanSquare,
  Contact as ContactIcon,
  Building2,
  Radar,
  Megaphone,
  Newspaper,
  CalendarDays,
  Award,
  MessageSquare,
  Pin,
  PinOff,
  BarChart3,
  Plus,
  Search,
  Clock,
  MessageCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { Avatar } from "@/components/app/avatar";
import { useConfirm } from "@/components/ui/confirm";
import { AttachPicker } from "@/components/inbox/attach-picker";
import { useRealtime } from "@/components/app/realtime-provider";
import {
  createFeedPost,
  toggleReaction,
  deleteFeedPost,
  togglePin,
  addFeedComment,
  deleteFeedComment,
  voteFeedPoll,
} from "@/app/actions/feed";
import { FEED_EMOJIS, FEED_CATEGORIES } from "@/lib/feed";
import type { FeedPostView } from "@/lib/queries/feed";
import type { AttachKind } from "@/lib/queries/team-chat";

type Member = { userId: string; name: string; avatarUrl: string | null };
type DraftAttachment = { type: AttachKind; id: string; label: string };

const ATTACH_ICONS: Record<string, typeof CheckSquare> = {
  TASK: CheckSquare,
  OPP: KanbanSquare,
  CONTACT: ContactIcon,
  COMPANY: Building2,
  LEAD: Radar,
};

/** Per-category badge icon + tint. */
const CATEGORY_META: Record<string, { icon: typeof Megaphone; className: string }> = {
  GENERAL: { icon: MessageSquare, className: "bg-muted text-muted-foreground" },
  ANNOUNCEMENT: { icon: Megaphone, className: "bg-amber-500/15 text-amber-600" },
  NEWS: { icon: Newspaper, className: "bg-sky-500/15 text-sky-600" },
  EVENT: { icon: CalendarDays, className: "bg-violet-500/15 text-violet-600" },
  PRAISE: { icon: Award, className: "bg-emerald-500/15 text-emerald-600" },
};

function fmtWhen(value: string | Date): string {
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function FeedClient({
  initialPosts,
  members,
  currentUserId,
  canPost,
  attachKinds,
}: {
  initialPosts: FeedPostView[];
  members: Member[];
  currentUserId: string;
  canPost: boolean;
  /** Attach types the org can link (gated by installed modules). Empty = no attach. */
  attachKinds: AttachKind[];
}) {
  const t = useTranslations("feed");

  const [posts, setPosts] = useState<FeedPostView[]>(initialPosts);
  const [filterCat, setFilterCat] = useState<string>("ALL");
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [query, setQuery] = useState("");

  const refetch = useCallback(async () => {
    try {
      const r = await fetch("/api/feed", { cache: "no-store" });
      if (r.ok) setPosts(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  useRealtime("feed", refetch);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter((p) => {
      if (onlyPinned && !p.pinnedAt) return false;
      if (filterCat !== "ALL" && p.category !== filterCat) return false;
      if (q) {
        const hay = `${p.body ?? ""} ${p.authorName} ${p.poll?.options.map((o) => o.text).join(" ") ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [posts, filterCat, onlyPinned, query]);

  return (
    <div className="flex flex-col gap-5">
      {canPost ? <Composer members={members} currentUserId={currentUserId} onPosted={refetch} attachKinds={attachKinds} /> : null}

      {posts.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full rounded-lg border border-border bg-card/60 py-2 pl-9 pr-3 text-sm backdrop-blur-sm focus-visible:border-brand focus-visible:outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={filterCat === "ALL"} onClick={() => setFilterCat("ALL")}>
              {t("filterAll")}
            </FilterChip>
            {FEED_CATEGORIES.map((c) => {
              const Icon = CATEGORY_META[c].icon;
              return (
                <FilterChip key={c} active={filterCat === c} onClick={() => setFilterCat(c)}>
                  <Icon className="size-3.5" />
                  {t(`category.${c}`)}
                </FilterChip>
              );
            })}
            <FilterChip active={onlyPinned} onClick={() => setOnlyPinned((v) => !v)}>
              <Pin className="size-3.5" />
              {t("filterPinned")}
            </FilterChip>
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <Megaphone className="size-8 opacity-30" />
          <p className="text-sm">{posts.length === 0 ? t("empty") : t("emptyFiltered")}</p>
        </div>
      ) : (
        // Masonry "wall": fills the full width (matching the dashboard) with a
        // comfortable column width instead of one stretched column.
        <div className="columns-1 gap-4 lg:columns-2 2xl:columns-3">
          {filtered.map((post) => (
            <div key={post.id} className="mb-4 break-inside-avoid">
              <PostCard
                post={post}
                currentUserId={currentUserId}
                canManage={canPost}
                setPosts={setPosts}
                refetch={refetch}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Composer ─────────────────────────────────────────────────────────────── */

function Composer({
  members,
  currentUserId,
  onPosted,
  attachKinds,
}: {
  members: Member[];
  currentUserId: string;
  onPosted: () => void;
  attachKinds: AttachKind[];
}) {
  const t = useTranslations("feed");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("GENERAL");
  const [pinned, setPinned] = useState(false);
  const [ephemeral, setEphemeral] = useState(false);
  const [mentions, setMentions] = useState<Member[]>([]);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [pollOn, setPollOn] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [posting, setPosting] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function onBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setBody(v);
    const caret = e.target.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/@(\w*)$/);
    setMentionQuery(m ? m[1].toLowerCase() : null);
  }

  function pickMention(member: Member) {
    setBody((prev) => prev.replace(/@(\w*)$/, `@${member.name} `));
    setMentions((prev) => (prev.some((x) => x.userId === member.userId) ? prev : [...prev, member]));
    setMentionQuery(null);
    textareaRef.current?.focus();
  }

  const mentionMatches =
    mentionQuery !== null
      ? members.filter((m) => m.userId !== currentUserId && m.name.toLowerCase().includes(mentionQuery)).slice(0, 6)
      : [];

  const validPoll = pollOn ? pollOptions.filter((o) => o.trim()).length >= 2 : true;
  const hasContent = Boolean(body.trim()) || attachments.length > 0 || (pollOn && validPoll);

  async function onPost() {
    if (posting || !hasContent) return;
    setPosting(true);
    const res = await createFeedPost({
      body: body.trim() || undefined,
      category,
      pinned,
      ephemeral: pinned ? false : ephemeral,
      attachments: attachments.map((a) => ({ type: a.type, id: a.id })),
      mentions: mentions.map((m) => m.userId),
      poll: pollOn ? pollOptions.map((o) => o.trim()).filter(Boolean) : undefined,
    });
    setPosting(false);
    if (res.ok) {
      setBody("");
      setCategory("GENERAL");
      setPinned(false);
      setEphemeral(false);
      setMentions([]);
      setAttachments([]);
      setPollOn(false);
      setPollOptions(["", ""]);
      onPosted();
    }
  }

  return (
    <div className="glass rounded-xl border border-border p-4 shadow-sm">
      {/* Category selector */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FEED_CATEGORIES.map((c) => {
          const Icon = CATEGORY_META[c].icon;
          const active = category === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                active ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-3.5" />
              {t(`category.${c}`)}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={onBodyChange}
          rows={3}
          placeholder={t("composerPlaceholder")}
          className="w-full resize-none rounded-lg border border-border bg-card/70 px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
        />
        {mentionMatches.length > 0 ? (
          <div className="glass-strong absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border shadow-xl">
            {mentionMatches.map((m) => (
              <button
                key={m.userId}
                type="button"
                onClick={() => pickMention(m)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <Avatar name={m.name} src={m.avatarUrl} className="size-6 text-[10px]" />
                {m.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Poll builder */}
      {pollOn ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <BarChart3 className="size-3.5" />
            {t("poll.title")}
          </div>
          {pollOptions.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={opt}
                onChange={(e) => setPollOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
                maxLength={120}
                placeholder={t("poll.optionPlaceholder", { n: i + 1 })}
                className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus-visible:border-brand focus-visible:outline-none"
              />
              {pollOptions.length > 2 ? (
                <button
                  type="button"
                  onClick={() => setPollOptions((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={t("remove")}
                  className="text-muted-foreground hover:text-red-600"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
          ))}
          {pollOptions.length < 6 ? (
            <button
              type="button"
              onClick={() => setPollOptions((prev) => [...prev, ""])}
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-brand hover:underline"
            >
              <Plus className="size-3.5" />
              {t("poll.addOption")}
            </button>
          ) : null}
        </div>
      ) : null}

      {mentions.length > 0 || attachments.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {mentions.map((m) => (
            <span key={m.userId} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">
              <AtSign className="size-3" />
              {m.name}
              <button type="button" onClick={() => setMentions((p) => p.filter((x) => x.userId !== m.userId))} aria-label={t("remove")}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          {attachments.map((a) => {
            const Icon = ATTACH_ICONS[a.type] ?? Paperclip;
            return (
              <span key={`${a.type}-${a.id}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                <Icon className="size-3 text-brand" />
                <span className="max-w-32 truncate">{a.label}</span>
                <button type="button" onClick={() => setAttachments((p) => p.filter((x) => !(x.type === a.type && x.id === a.id)))} aria-label={t("remove")}>
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {attachKinds.length > 0 ? (
            <ToolToggle active={false} onClick={() => setAttachOpen(true)} title={t("attach")}>
              <Paperclip className="size-4" />
            </ToolToggle>
          ) : null}
          <ToolToggle active={pollOn} onClick={() => setPollOn((v) => !v)} title={t("poll.toggle")}>
            <BarChart3 className="size-4" />
          </ToolToggle>
          <ToolToggle active={pinned} onClick={() => setPinned((v) => !v)} title={t("pinToggle")}>
            <Pin className="size-4" />
          </ToolToggle>
          <ToolToggle active={ephemeral && !pinned} onClick={() => setEphemeral((v) => !v)} disabled={pinned} title={t("ephemeralToggle")}>
            <Clock className="size-4" />
          </ToolToggle>
        </div>
        <button
          type="button"
          onClick={onPost}
          disabled={posting || !hasContent}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Send className="size-4" />
          {t("post")}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {pinned ? t("hintPinned") : ephemeral ? t("hintEphemeral") : t("hintPermanent")}
      </p>

      {attachOpen ? (
        <AttachPicker
          allowedKinds={attachKinds}
          onPick={(type, id, label) => {
            setAttachments((prev) => (prev.some((a) => a.type === type && a.id === id) ? prev : [...prev, { type, id, label }]));
            setAttachOpen(false);
          }}
          onClose={() => setAttachOpen(false)}
        />
      ) : null}
    </div>
  );
}

/* ── Post card ────────────────────────────────────────────────────────────── */

function PostCard({
  post,
  currentUserId,
  canManage,
  setPosts,
  refetch,
}: {
  post: FeedPostView;
  currentUserId: string;
  canManage: boolean;
  setPosts: React.Dispatch<React.SetStateAction<FeedPostView[]>>;
  refetch: () => void;
}) {
  const t = useTranslations("feed");
  const confirm = useConfirm();
  const [showComments, setShowComments] = useState(false);
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);

  const cat = CATEGORY_META[post.category] ?? CATEGORY_META.GENERAL;
  const CatIcon = cat.icon;
  const isPinned = Boolean(post.pinnedAt);
  const canDelete = post.authorId === currentUserId || canManage;

  async function onReact(emoji: string) {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== post.id) return p;
        const idx = p.reactions.findIndex((r) => r.emoji === emoji);
        const reactions = [...p.reactions];
        if (idx >= 0) {
          const r = reactions[idx];
          const count = r.count + (r.mine ? -1 : 1);
          if (count <= 0) reactions.splice(idx, 1);
          else reactions[idx] = { emoji, count, mine: !r.mine };
        } else {
          reactions.push({ emoji, count: 1, mine: true });
        }
        return { ...p, reactions };
      }),
    );
    await toggleReaction(post.id, emoji);
    refetch();
  }

  async function onVote(optionId: string) {
    // Optimistic single-choice update.
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== post.id || !p.poll) return p;
        const wasMine = p.poll.myOptionId;
        const options = p.poll.options.map((o) => {
          let votes = o.votes;
          let mine = o.mine;
          if (o.id === optionId) {
            if (wasMine === optionId) {
              votes -= 1;
              mine = false;
            } else {
              votes += 1;
              mine = true;
            }
          } else if (o.id === wasMine) {
            votes -= 1;
            mine = false;
          }
          return { ...o, votes, mine };
        });
        const myOptionId = wasMine === optionId ? null : optionId;
        const totalVotes = options.reduce((s, o) => s + o.votes, 0);
        return { ...p, poll: { options, myOptionId, totalVotes } };
      }),
    );
    await voteFeedPoll(post.id, optionId);
    refetch();
  }

  async function onPin() {
    await togglePin(post.id);
    refetch();
  }

  async function onDelete() {
    const ok = await confirm({ description: t("deleteConfirm"), confirmLabel: t("delete"), variant: "danger" });
    if (!ok) return;
    setPosts((prev) => prev.filter((p) => p.id !== post.id));
    await deleteFeedPost(post.id);
    refetch();
  }

  async function onAddComment() {
    const text = comment.trim();
    if (!text || commenting) return;
    setCommenting(true);
    const res = await addFeedComment({ postId: post.id, body: text });
    setCommenting(false);
    if (res.ok) {
      setComment("");
      refetch();
    }
  }

  async function onDeleteComment(commentId: string) {
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, comments: p.comments.filter((c) => c.id !== commentId) } : p)));
    await deleteFeedComment(commentId);
    refetch();
  }

  return (
    <article className={cn("glass hover-lift rounded-xl border p-4 shadow-sm", isPinned ? "border-brand/40" : "border-border")}>
      <div className="flex items-start gap-3">
        <Avatar name={post.authorName} src={post.authorAvatar} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium">{post.authorName}</p>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", cat.className)}>
                <CatIcon className="size-3" />
                {t(`category.${post.category}`)}
              </span>
              {isPinned ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
                  <Pin className="size-3" />
                  {t("pinned")}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground">{fmtWhen(post.createdAt)}</span>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => void onPin()}
                  aria-label={isPinned ? t("unpin") : t("pin")}
                  title={isPinned ? t("unpin") : t("pin")}
                  className={cn("transition-colors hover:text-brand", isPinned ? "text-brand" : "text-muted-foreground")}
                >
                  {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  onClick={() => void onDelete()}
                  aria-label={t("delete")}
                  className="text-muted-foreground transition-colors hover:text-red-600"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>

          {post.body ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{post.body}</p> : null}

          {post.mentions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {post.mentions.map((m) => (
                <span key={m.userId} className="inline-flex items-center gap-0.5 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
                  <AtSign className="size-2.5" />
                  {m.name}
                </span>
              ))}
            </div>
          ) : null}

          {/* Poll */}
          {post.poll ? (
            <div className="mt-3 flex flex-col gap-1.5">
              {post.poll.options.map((o) => {
                const pct = post.poll!.totalVotes > 0 ? Math.round((o.votes / post.poll!.totalVotes) * 100) : 0;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => void onVote(o.id)}
                    className={cn(
                      "relative overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      o.mine ? "border-brand" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("absolute inset-y-0 left-0 rounded-lg transition-all", o.mine ? "bg-brand/15" : "bg-muted")}
                      style={{ width: `${pct}%` }}
                    />
                    <span className="relative flex items-center justify-between gap-2">
                      <span className={cn("truncate", o.mine && "font-medium text-brand")}>{o.text}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{pct}%</span>
                    </span>
                  </button>
                );
              })}
              <p className="text-xs text-muted-foreground">{t("poll.votes", { count: post.poll.totalVotes })}</p>
            </div>
          ) : null}

          {post.attachments.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1.5">
              {post.attachments.map((a) => {
                const Icon = ATTACH_ICONS[a.type] ?? Paperclip;
                return (
                  <Link
                    key={a.id}
                    href={a.href}
                    className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-2 transition-colors hover:bg-muted"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{t(`attachType.${a.type}`)}</span>
                      <span className="block truncate text-sm font-medium">{a.label}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : null}

          {/* Reactions + comment toggle */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {FEED_EMOJIS.map((emoji) => {
              const r = post.reactions.find((x) => x.emoji === emoji);
              const count = r?.count ?? 0;
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => void onReact(emoji)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                    r?.mine ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span>{emoji}</span>
                  {count > 0 ? <span className="tabular-nums">{count}</span> : null}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowComments((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                showComments ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              <MessageCircle className="size-3.5" />
              {post.comments.length > 0 ? post.comments.length : null}
              <span>{t("comments")}</span>
            </button>
          </div>

          {/* Comments */}
          {showComments ? (
            <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
              {post.comments.map((c) => {
                const canDeleteComment = c.authorId === currentUserId || canManage;
                return (
                  <div key={c.id} className="flex items-start gap-2">
                    <Avatar name={c.authorName} src={c.authorAvatar} className="size-7 text-[10px]" />
                    <div className="min-w-0 flex-1 rounded-lg bg-muted/40 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">{c.authorName}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">{fmtWhen(c.createdAt)}</span>
                          {canDeleteComment ? (
                            <button
                              type="button"
                              onClick={() => void onDeleteComment(c.id)}
                              aria-label={t("delete")}
                              className="text-muted-foreground transition-colors hover:text-red-600"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.body}</p>
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center gap-2">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onAddComment();
                    }
                  }}
                  placeholder={t("commentPlaceholder")}
                  className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus-visible:border-brand focus-visible:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void onAddComment()}
                  disabled={!comment.trim() || commenting}
                  aria-label={t("sendComment")}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/* ── Small shared bits ────────────────────────────────────────────────────── */

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function ToolToggle({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg border transition-colors disabled:opacity-40",
        active ? "border-brand bg-brand/10 text-brand" : "border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
