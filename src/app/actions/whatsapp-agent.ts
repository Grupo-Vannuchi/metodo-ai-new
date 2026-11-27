"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { hasFeatureByModules } from "@/config/modules";
import { whatsappAgentSchema } from "@/lib/validations/whatsapp-agent";

export type WhatsappAgentResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "unknown" };

const s = (v?: string) => (v && v.trim() ? v.trim() : null);

/**
 * Save (create or update) the AI agent config for a WhatsApp connection. Only
 * the number's owner, for every role: the agent answers that person's chats,
 * which nobody else can read (the inbox is per user). An admin who must stop it
 * disconnects the number instead (`canManageConnection`).
 */
export async function saveWhatsappAgent(connectionId: string, input: unknown): Promise<WhatsappAgentResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!hasFeatureByModules(ctx.modules, "whatsapp_agent")) return { ok: false, error: "forbidden" };
  const parsed = whatsappAgentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  try {
    const db = tenantDb(ctx.organizationId);
    // The connection must exist in the org and be a WhatsApp (Evolution) channel.
    const conn = await db.integrationConnection.findFirst({
      where: { id: connectionId, provider: "EVOLUTION" },
      select: { id: true, ownerId: true },
    });
    if (!conn) return { ok: false, error: "invalid" };
    if (conn.ownerId !== ctx.userId) return { ok: false, error: "forbidden" };

    const data = {
      enabled: d.enabled,
      name: s(d.name),
      prompt: d.prompt.trim(),
      model: d.model,
      handoffMinutes: d.handoffMinutes,
    };

    const existing = await db.whatsappAgent.findFirst({ where: { connectionId }, select: { id: true } });
    if (existing) {
      await db.whatsappAgent.updateMany({ where: { connectionId }, data });
    } else {
      await db.whatsappAgent.create({
        data: { organizationId: ctx.organizationId, connectionId, createdById: ctx.userId, ...data },
      });
    }

    revalidatePath(`/app/connections/${connectionId}`);
    return { ok: true };
  } catch (e) {
    console.error("saveWhatsappAgent failed", e);
    return { ok: false, error: "unknown" };
  }
}
