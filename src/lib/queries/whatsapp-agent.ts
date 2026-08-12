import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type WhatsappAgentRow = {
  enabled: boolean;
  name: string | null;
  prompt: string;
  model: string;
  handoffMinutes: number;
};

/** The agent config for a WhatsApp connection, or null if never configured. */
export async function getWhatsappAgent(organizationId: string, connectionId: string): Promise<WhatsappAgentRow | null> {
  const a = await tenantDb(organizationId).whatsappAgent.findFirst({
    where: { connectionId },
    select: { enabled: true, name: true, prompt: true, model: true, handoffMinutes: true },
  });
  return a ?? null;
}
