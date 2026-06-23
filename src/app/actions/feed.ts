"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TeamChatAttachmentType } from "@prisma/client";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { resolveAttachment } from "@/lib/attachables";
import { FEED_EMOJIS } from "@/lib/feed";

type Ok = { ok: boolean };
export type FeedResult = { ok: true; id?: string } | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "unknown" };

const postSchema = z
  .object({
    body: z.string().trim().max(2000).optional(),
    attachments: z
      .array(z.object({ type: z.nativeEnum(TeamChatAttachmentType), id: z.string().trim().min(1).max(64) }))
      .max(10)
      .optional(),
    mentions: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
  })
  .refine((d) => Boolean(d.body) || (d.attachments?.length ?? 0) > 0, { message: "empty post" });

const isManager = (role: string) => role === "OWNER" || role === "ADMIN";

/** Create a feed post. Managers only. Resolves attachments, records mentions,
 * and notifies the team (mentioned members get a mention notification). */
export async function createFeedPost(input: unknown): Promise<FeedResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!isManager(ctx.role)) return { ok: false, error: "forbidden" };

  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { body, attachments = [], mentions = [] } = parsed.data;

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

    const post = await db.feedPost.create({
      data: {
        organizationId: org,
        authorId: ctx.userId,
        body: body || null,
        attachments: {
          create: resolved.map((a) => ({ organizationId: org, type: a.type, entityId: a.entityId, label: a.label, href: a.href })),
        },
        mentions: {
          create: mentioned.map((userId) => ({ organizationId: org, userId })),
        },
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
