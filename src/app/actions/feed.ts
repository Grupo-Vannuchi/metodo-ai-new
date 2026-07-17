"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TeamChatAttachmentType, FeedCategory } from "@prisma/client";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { resolveAttachment } from "@/lib/attachables";
import { FEED_EMOJIS, FEED_TTL_MS } from "@/lib/feed";

type Ok = { ok: boolean };
export type FeedResult = { ok: true; id?: string } | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "unknown" };

const postSchema = z
  .object({
    body: z.string().trim().max(2000).optional(),
    category: z.nativeEnum(FeedCategory).optional(),
    /** Pin to the top of the wall (managers) — pinned posts never expire. */
    pinned: z.boolean().optional(),
    /** Ephemeral: disappears after 24h. Ignored when pinned. */
    ephemeral: z.boolean().optional(),
    attachments: z
      .array(z.object({ type: z.nativeEnum(TeamChatAttachmentType), id: z.string().trim().min(1).max(64) }))
      .max(10)
      .optional(),
    mentions: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
    /** Poll option texts — a post is a poll when it has 2+ options. */
    poll: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
  })
  .refine(
    (d) => Boolean(d.body) || (d.attachments?.length ?? 0) > 0 || (d.poll?.filter((o) => o.trim()).length ?? 0) >= 2,
    { message: "empty post" },
  );

const commentSchema = z.object({
  postId: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1).max(2000),
});

const isManager = (role: string) => role === "OWNER" || role === "ADMIN";

/** Create a wall post. Managers only. Resolves attachments, records mentions,
 * builds a poll (2+ options), sets pin/expiry, and notifies the team. */
export async function createFeedPost(input: unknown): Promise<FeedResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!isManager(ctx.role)) return { ok: false, error: "forbidden" };

  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { body, category = "GENERAL", pinned = false, ephemeral = false, attachments = [], mentions = [], poll = [] } = parsed.data;

  try {
    const org = ctx.organizationId;
    const db = tenantDb(org);

    // Resolve each attachment to a label/link (drops any that don't belong here).
    const resolved = (
      await Promise.all(
        attachments.map(async (a) => {
          const r = await resolveAttachment(db, a.type, a.id);
          return r ? { type: a.type, entityId: a.id, label: r.label, href: r.href } : null;
        }),
      )
    ).filter((x): x is NonNullable<typeof x> => x !== null);

    // Keep only mentions that are real members of this org.
    const members = await prisma.membership.findMany({ where: { organizationId: org }, select: { userId: true } });
    const memberIds = new Set(members.map((m) => m.userId));
    const mentioned = [...new Set(mentions)].filter((id) => memberIds.has(id) && id !== ctx.userId);

    const pollOptions = poll.map((o) => o.trim()).filter(Boolean);
    // Pinned posts are always permanent; otherwise honour the ephemeral choice.
    const expiresAt = pinned ? null : ephemeral ? new Date(Date.now() + FEED_TTL_MS) : null;

    const post = await db.feedPost.create({
      data: {
        organizationId: org,
        authorId: ctx.userId,
        body: body || null,
        category,
        pinnedAt: pinned ? new Date() : null,
        expiresAt,
        attachments: {
          create: resolved.map((a) => ({ organizationId: org, type: a.type, entityId: a.entityId, label: a.label, href: a.href })),
        },
        mentions: {
          create: mentioned.map((userId) => ({ organizationId: org, userId })),
        },
        pollOptions:
          pollOptions.length >= 2
            ? { create: pollOptions.map((text, i) => ({ organizationId: org, text, order: i })) }
            : undefined,
      },
      select: { id: true },
    });

    // Notify the team: mentioned members get a mention; everyone else a post alert.
    const recipients = members.map((m) => m.userId).filter((id) => id !== ctx.userId);
    if (recipients.length > 0) {
      const mentionedSet = new Set(mentioned);
      await db.notification.createMany({
        data: recipients.map((userId) => ({
          organizationId: org,
          userId,
          type: mentionedSet.has(userId) ? "FEED_MENTION" : "FEED_POST",
          data: { actor: ctx.user.name },
          link: "/app/feed",
        })),
      });
    }

    revalidatePath("/app/feed");
    return { ok: true, id: post.id };
  } catch (error) {
    console.error("Failed to create feed post", error);
    return { ok: false, error: "unknown" };
  }
}

/** Pin/unpin a post to the top of the wall (managers). Pinning also makes it
 * permanent so it never expires out from under the pin. */
export async function togglePin(postId: string): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx || !isManager(ctx.role)) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    const post = await db.feedPost.findFirst({ where: { id: postId }, select: { pinnedAt: true } });
    if (!post) return { ok: false };
    const pin = post.pinnedAt === null;
    await db.feedPost.updateMany({
      where: { id: postId },
      data: pin ? { pinnedAt: new Date(), expiresAt: null } : { pinnedAt: null },
    });
    revalidatePath("/app/feed");
    return { ok: true };
  } catch (error) {
    console.error("Failed to toggle pin", error);
    return { ok: false };
  }
}

/** Add a comment to a post — any member. Notifies the post author. */
export async function addFeedComment(input: unknown): Promise<FeedResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const post = await db.feedPost.findFirst({ where: { id: parsed.data.postId }, select: { id: true, authorId: true } });
    if (!post) return { ok: false, error: "invalid" };

    const comment = await db.feedComment.create({
      data: { organizationId: ctx.organizationId, postId: post.id, authorId: ctx.userId, body: parsed.data.body },
      select: { id: true },
    });

    if (post.authorId !== ctx.userId) {
      await db.notification.create({
        data: {
          organizationId: ctx.organizationId,
          userId: post.authorId,
          type: "FEED_COMMENT",
          data: { actor: ctx.user.name },
          link: "/app/feed",
        },
      });
    }

    revalidatePath("/app/feed");
    return { ok: true, id: comment.id };
  } catch (error) {
    console.error("Failed to add comment", error);
    return { ok: false, error: "unknown" };
  }
}

/** Delete a comment — its author or any manager. */
export async function deleteFeedComment(commentId: string): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    const comment = await db.feedComment.findFirst({ where: { id: commentId }, select: { authorId: true } });
    if (!comment) return { ok: false };
    if (comment.authorId !== ctx.userId && !isManager(ctx.role)) return { ok: false };
    await db.feedComment.deleteMany({ where: { id: commentId } });
    revalidatePath("/app/feed");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete comment", error);
    return { ok: false };
  }
}

/** Cast/switch/undo a single-choice poll vote — any member. */
export async function voteFeedPoll(postId: string, optionId: string): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    // The option must belong to this post (ownership/tenant boundary).
    const option = await db.feedPollOption.findFirst({ where: { id: optionId, postId }, select: { id: true } });
    if (!option) return { ok: false };

    const existing = await db.feedPollVote.findFirst({
      where: { postId, userId: ctx.userId },
      select: { id: true, optionId: true },
    });
    if (!existing) {
      await db.feedPollVote.create({
        data: { organizationId: ctx.organizationId, postId, optionId, userId: ctx.userId },
      });
    } else if (existing.optionId === optionId) {
      await db.feedPollVote.deleteMany({ where: { id: existing.id } }); // toggle off
    } else {
      await db.feedPollVote.updateMany({ where: { id: existing.id }, data: { optionId } }); // switch
    }
    revalidatePath("/app/feed");
    return { ok: true };
  } catch (error) {
    console.error("Failed to vote poll", error);
    return { ok: false };
  }
}

/** Toggle the current user's reaction (one of FEED_EMOJIS) on a post. Notifies
 * the author when a reaction is added. */
export async function toggleReaction(postId: string, emoji: string): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  if (!FEED_EMOJIS.includes(emoji as (typeof FEED_EMOJIS)[number])) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    const post = await db.feedPost.findFirst({ where: { id: postId }, select: { id: true, authorId: true } });
    if (!post) return { ok: false };

    const existing = await db.feedReaction.findFirst({
      where: { postId, userId: ctx.userId, emoji },
      select: { id: true },
    });
    if (existing) {
      await db.feedReaction.deleteMany({ where: { id: existing.id } });
    } else {
      await db.feedReaction.create({
        data: { organizationId: ctx.organizationId, postId, userId: ctx.userId, emoji },
      });
      if (post.authorId !== ctx.userId) {
        await db.notification.create({
          data: {
            organizationId: ctx.organizationId,
            userId: post.authorId,
            type: "FEED_REACTION",
            data: { actor: ctx.user.name, emoji },
            link: "/app/feed",
          },
        });
      }
    }
    revalidatePath("/app/feed");
    return { ok: true };
  } catch (error) {
    console.error("Failed to toggle reaction", error);
    return { ok: false };
  }
}

/** Delete a post — its author or any manager. */
export async function deleteFeedPost(postId: string): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    const post = await db.feedPost.findFirst({ where: { id: postId }, select: { authorId: true } });
    if (!post) return { ok: false };
    if (post.authorId !== ctx.userId && !isManager(ctx.role)) return { ok: false };
    await db.feedPost.deleteMany({ where: { id: postId } });
    revalidatePath("/app/feed");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete feed post", error);
    return { ok: false };
  }
}
