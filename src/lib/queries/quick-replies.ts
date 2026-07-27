import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type QuickReply = { id: string; name: string; body: string };

/**
 * Canned WhatsApp replies for the inbox composer. Reuses the WhatsApp message
 * templates (managed under Campaigns → Templates), so there's one place to
 * maintain them.
 */
export async function listQuickReplies(organizationId: string): Promise<QuickReply[]> {
  const db = tenantDb(organizationId);
  return db.messageTemplate.findMany({
    where: { channel: { in: ["WHATSAPP_EVOLUTION", "WHATSAPP_CLOUD"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, body: true },
    take: 100,
  });
}
