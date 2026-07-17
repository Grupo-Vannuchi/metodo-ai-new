import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type FeedAttachment = { id: string; type: string; label: string; href: string };
export type FeedMentionRow = { userId: string; name: string };
export type FeedReactionSummary = { emoji: string; count: number; mine: boolean };
export type FeedCommentRow = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  body: string;
  createdAt: Date;
};
export type FeedPollOptionView = { id: string; text: string; votes: number; mine: boolean };
export type FeedPollView = { options: FeedPollOptionView[]; totalVotes: number; myOptionId: string | null };

export type FeedPostView = {
  id: string;
  body: string | null;
  category: string;
  pinnedAt: Date | null;
  createdAt: Date;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  attachments: FeedAttachment[];
  mentions: FeedMentionRow[];
  reactions: FeedReactionSummary[];
  comments: FeedCommentRow[];
  poll: FeedPollView | null;
};

/** The team wall: active posts (not expired), pinned first then newest, with
 * author, attachments, mentions, reactions, comments and any poll already
 * grouped for the signed-in user. Permanent posts have `expiresAt = null`. */
export async function listFeed(organizationId: string, userId: string): Promise<FeedPostView[]> {
  const db = tenantDb(organizationId);
  const now = new Date();

  const posts = await db.feedPost.findMany({
    where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      body: true,
      category: true,
      pinnedAt: true,
      createdAt: true,
      authorId: true,
      author: { select: { name: true, profile: { select: { avatarUrl: true } } } },
      attachments: { select: { id: true, type: true, label: true, href: true } },
      mentions: { select: { userId: true, user: { select: { name: true } } } },
      reactions: { select: { userId: true, emoji: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          authorId: true,
          body: true,
          createdAt: true,
          author: { select: { name: true, profile: { select: { avatarUrl: true } } } },
        },
      },
      pollOptions: {
        orderBy: { order: "asc" },
        select: { id: true, text: true, votes: { select: { userId: true } } },
      },
    },
  });

  return posts.map((p) => {
    const byEmoji = new Map<string, { count: number; mine: boolean }>();
    for (const r of p.reactions) {
      const e = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
      e.count += 1;
      if (r.userId === userId) e.mine = true;
      byEmoji.set(r.emoji, e);
    }

    let poll: FeedPollView | null = null;
    if (p.pollOptions.length >= 2) {
      let myOptionId: string | null = null;
      let totalVotes = 0;
      const options = p.pollOptions.map((o) => {
        const mine = o.votes.some((v) => v.userId === userId);
        if (mine) myOptionId = o.id;
        totalVotes += o.votes.length;
        return { id: o.id, text: o.text, votes: o.votes.length, mine };
      });
      poll = { options, totalVotes, myOptionId };
    }

    return {
      id: p.id,
      body: p.body,
      category: p.category,
      pinnedAt: p.pinnedAt,
      createdAt: p.createdAt,
      authorId: p.authorId,
      authorName: p.author.name,
      authorAvatar: p.author.profile?.avatarUrl ?? null,
      attachments: p.attachments.map((a) => ({ id: a.id, type: a.type, label: a.label, href: a.href })),
      mentions: p.mentions.map((m) => ({ userId: m.userId, name: m.user.name })),
      reactions: [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
      comments: p.comments.map((c) => ({
        id: c.id,
        authorId: c.authorId,
        authorName: c.author.name,
        authorAvatar: c.author.profile?.avatarUrl ?? null,
        body: c.body,
        createdAt: c.createdAt,
      })),
      poll,
    };
  });
}
