"use client";

import { useCallback, useRef, useState } from "react";
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
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { Avatar } from "@/components/app/avatar";
import { useConfirm } from "@/components/ui/confirm";
import { AttachPicker } from "@/components/inbox/attach-picker";
import { useRealtime } from "@/components/app/realtime-provider";
import { createFeedPost, toggleReaction, deleteFeedPost } from "@/app/actions/feed";
import { FEED_EMOJIS } from "@/lib/feed";
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

function fmtWhen(value: string | Date): string {
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function FeedClient({
  initialPosts,
  members,
  currentUserId,
  canPost,
}: {
  initialPosts: FeedPostView[];
  members: Member[];
  currentUserId: string;
  canPost: boolean;
}) {
  const t = useTranslations("feed");
  const confirm = useConfirm();

  const [posts, setPosts] = useState<FeedPostView[]>(initialPosts);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<Member[]>([]);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refetch = useCallback(async () => {
    try {
      const r = await fetch("/api/feed", { cache: "no-store" });
      if (r.ok) setPosts(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  useRealtime("feed", refetch);

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
      ? members
          .filter((m) => m.userId !== currentUserId && m.name.toLowerCase().includes(mentionQuery))
          .slice(0, 6)
      : [];

  async function onPost() {
    if (posting || (!body.trim() && attachments.length === 0)) return;
    setPosting(true);
    const res = await createFeedPost({
      body: body.trim() || undefined,
      attachments: attachments.map((a) => ({ type: a.type, id: a.id })),
      mentions: mentions.map((m) => m.userId),
    });
    setPosting(false);
    if (res.ok) {
      setBody("");
      setMentions([]);
      setAttachments([]);
      void refetch();
    }
  }

  async function onReact(postId: string, emoji: string) {
    // Optimistic toggle, reconciled by refetch.
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
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
    await toggleReaction(postId, emoji);
    void refetch();
  }

  async function onDelete(postId: string) {
    const ok = await confirm({ description: t("deleteConfirm"), confirmLabel: t("delete"), variant: "danger" });
    if (!ok) return;
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    await deleteFeedPost(postId);
    void refetch();
  }

  return (
    <div className="flex flex-col gap-5">
      {canPost ? (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={body}
              onChange={onBodyChange}
              rows={3}
              placeholder={t("composerPlaceholder")}
              className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:border-brand focus-visible:outline-none"
            />
            {mentionMatches.length > 0 ? (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
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

          {(mentions.length > 0 || attachments.length > 0) ? (
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

          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setAttachOpen(true)}
              title={t("attach")}
              aria-label={t("attach")}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Paperclip className="size-4" />
            </button>
            <button
              type="button"
              onClick={onPost}
              disabled={posting || (!body.trim() && attachments.length === 0)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send className="size-4" />
              {t("post")}
            </button>
          </div>
        </div>
      ) : null}

      {posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <Megaphone className="size-8 opacity-30" />
          <p className="text-sm">{t("empty")}</p>
        </div>
      ) : (
        posts.map((post) => {
          const canDelete = post.authorId === currentUserId || canPost;
          return (
            <article key={post.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <Avatar name={post.authorName} src={post.authorAvatar} className="size-9" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{post.authorName}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">{fmtWhen(post.createdAt)}</span>
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => void onDelete(post.id)}
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

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {FEED_EMOJIS.map((emoji) => {
                      const r = post.reactions.find((x) => x.emoji === emoji);
                      const count = r?.count ?? 0;
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => void onReact(post.id, emoji)}
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
                  </div>
                </div>
              </div>
            </article>
          );
        })
      )}

      {attachOpen ? (
        <AttachPicker
          onPick={(type, id, label) => {
            setAttachments((prev) =>
              prev.some((a) => a.type === type && a.id === id) ? prev : [...prev, { type, id, label }],
            );
            setAttachOpen(false);
          }}
          onClose={() => setAttachOpen(false)}
        />
      ) : null}
    </div>
  );
}
