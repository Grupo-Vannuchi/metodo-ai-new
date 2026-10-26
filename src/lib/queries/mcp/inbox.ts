import "server-only";
import type { Period } from "@/lib/mcp/core";
import { userNames } from "@/lib/queries/mcp/shared";
import { tenantDb } from "@/lib/tenant-db";

/**
 * WhatsApp inbox summary of the MCP server — counts only. No message row is
 * ever selected (only counted), and conversations are never named: the JID is
 * the customer's number and `lastMessagePreview` is message content.
 */
export async function conversationsSummary(organizationId: string, period: Period) {
  const db = tenantDb(organizationId);
  const inPeriod = { gte: period.gte, lt: period.lt };
  const [connections, byConnection, total, groups, withUnread, unassigned, activeInPeriod, byDirection, byAssignee] =
    await Promise.all([
      db.integrationConnection.findMany({
        where: { provider: { in: ["EVOLUTION", "META_CLOUD"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, label: true, provider: true, status: true },
      }),
      db.conversation.groupBy({ by: ["connectionId"], _count: { _all: true }, _sum: { unreadCount: true } }),
      db.conversation.count({}),
      db.conversation.count({ where: { isGroup: true } }),
      db.conversation.count({ where: { unreadCount: { gt: 0 } } }),
      db.conversation.count({ where: { assignedToId: null } }),
      db.conversation.count({ where: { lastMessageAt: inPeriod } }),
      db.message.groupBy({ by: ["direction"], where: { timestamp: inPeriod }, _count: { _all: true } }),
      db.conversation.groupBy({
        by: ["assignedToId"],
        where: { assignedToId: { not: null } },
        _count: { _all: true },
      }),
    ]);

  const perConnection = new Map(byConnection.map((g) => [g.connectionId, g]));
  const names = await userNames(byAssignee.map((g) => g.assignedToId));
  const messagesOf = (direction: "INBOUND" | "OUTBOUND") =>
    byDirection.find((g) => g.direction === direction)?._count._all ?? 0;

  return {
    period: { from: period.from, to: period.to },
    connections: connections.map((c) => ({
      ...c,
      conversations: perConnection.get(c.id)?._count._all ?? 0,
      unread: perConnection.get(c.id)?._sum.unreadCount ?? 0,
    })),
    conversations: { total, groups, withUnread, unassigned, activeInPeriod },
    messages: { inbound: messagesOf("INBOUND"), outbound: messagesOf("OUTBOUND") },
    byAssignee: byAssignee
      .map((g) => ({
        userId: g.assignedToId as string,
        userName: names.get(g.assignedToId as string) ?? null,
        conversations: g._count._all,
      }))
      .sort((x, y) => y.conversations - x.conversations),
  };
}
