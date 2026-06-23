import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/** The change channels the realtime stream pushes. The client refetches the
 * matching data when a channel's fingerprint changes. */
export const REALTIME_EVENTS = ["notifications", "inbox", "teamChat", "crm", "tasks", "feed"] as const;
export type RealtimeEvent = (typeof REALTIME_EVENTS)[number];

export type RealtimeFingerprint = Record<RealtimeEvent, string>;

const ms = (d: Date | null | undefined) => d?.getTime() ?? 0;

/** Cheap per-channel fingerprints for one member. The stream compares these
 * every tick and emits an event only for channels that changed — so a tab only
 * refetches what actually moved. All aggregates are org-scoped by tenantDb. */
export async function realtimeFingerprints(
  organizationId: string,
  userId: string,
): Promise<RealtimeFingerprint> {
  const db = tenantDb(organizationId);
  const [notif, conv, tchatMsg, tchatUnread, opp, task, feedPost, feedReaction] = await Promise.all([
    db.notification.count({ where: { userId, readAt: null } }),
    db.conversation.aggregate({
      _max: { lastMessageAt: true },
      _sum: { unreadCount: true },
      _count: { _all: true },
    }),
    // Newest message across the user's chats — catches sends and receives.
    db.teamChat.aggregate({
      where: { participants: { some: { userId } } },
      _max: { lastMessageAt: true },
    }),
    db.teamChatParticipant.aggregate({ where: { userId }, _sum: { unreadCount: true } }),
    db.opportunity.aggregate({ _max: { updatedAt: true }, _count: { _all: true } }),
    db.task.aggregate({ _max: { updatedAt: true }, _count: { _all: true } }),
    db.feedPost.aggregate({ _max: { createdAt: true }, _count: { _all: true } }),
    db.feedReaction.aggregate({ _max: { createdAt: true }, _count: { _all: true } }),
  ]);

  return {
    notifications: String(notif),
    inbox: `${ms(conv._max.lastMessageAt)}:${conv._sum.unreadCount ?? 0}:${conv._count._all}`,
    teamChat: `${ms(tchatMsg._max.lastMessageAt)}:${tchatUnread._sum.unreadCount ?? 0}`,
    crm: `${ms(opp._max.updatedAt)}:${opp._count._all}`,
    tasks: `${ms(task._max.updatedAt)}:${task._count._all}`,
    feed: `${ms(feedPost._max.createdAt)}:${feedPost._count._all}:${ms(feedReaction._max.createdAt)}:${feedReaction._count._all}`,
  };
}
