import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { FEED_TTL_MS } from "@/lib/feed";

export type FeedAttachment = { id: string; type: string; label: string; href: string };
export type FeedMentionRow = { userId: string; name: string };
export type FeedReactionSummary = { emoji: string; count: number; mine: boolean };

export type FeedPostView = {
  id: string;
  body: string | null;
  createdAt: Date;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  attachments: FeedAttachment[];
  mentions: FeedMentionRow[];
  reactions: FeedReactionSummary[];
};

/** The team feed: posts from the last 24h (older ones are hidden and cleaned by
 * the cron), newest first, with author, attachments, mentions and reactions
 * already grouped for the signed-in user. */
export async function listFeed(organizationId: string, userId: string): Promise<FeedPostView[]> {
  const db = tenantDb(organizationId);
  const since = new Date(Date.now() - FEED_TTL_MS);

  const posts = await db.feedPost.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      body: true,
      createdAt: true,
      authorId: true,
      author: { select: { name: true, profile: { select: { avatarUrl: true } } } },
      attachments: { select: { id: true, type: true, label: true, href: true } },
      mentions: { select: { userId: true, user: { select: { name: true } } } },
      reactions: { select: { userId: true, emoji: true } },
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
    return {
      id: p.id,
      body: p.body,
      createdAt: p.createdAt,
      authorId: p.authorId,
      authorName: p.author.name,
      authorAvatar: p.author.profile?.avatarUrl ?? null,
      attachments: p.attachments.map((a) => ({ id: a.id, type: a.type, label: a.label, href: a.href })),
      mentions: p.mentions.map((m) => ({ userId: m.userId, name: m.user.name })),
      reactions: [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
    };
  });
}
