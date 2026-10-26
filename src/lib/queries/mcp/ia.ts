import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/**
 * AI reads of the MCP server: the WhatsApp agents' settings and how much the
 * in-app assistant is used — never an agent's prompt nor a conversation with
 * the assistant.
 */
export async function listAiAgents(organizationId: string) {
  const db = tenantDb(organizationId);
  const [agents, threads, messages] = await Promise.all([
    db.whatsappAgent.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        enabled: true,
        model: true,
        handoffMinutes: true,
        connectionId: true,
        updatedAt: true,
      },
    }),
    db.assistantThread.count({}),
    db.assistantMessage.count({}),
  ]);
  const connectionIds = agents.map((a) => a.connectionId);
  const connections = connectionIds.length
    ? await db.integrationConnection.findMany({
        where: { id: { in: connectionIds } },
        select: { id: true, label: true },
      })
    : [];
  const connectionLabel = new Map(connections.map((c) => [c.id, c.label]));
  return {
    items: agents.map(({ connectionId, ...agent }) => ({
      ...agent,
      connectionLabel: connectionLabel.get(connectionId) ?? null,
    })),
    assistant: { threads, messages },
  };
}
