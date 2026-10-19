"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasModule } from "@/config/modules";
import { audit } from "@/lib/audit";

export type SenderAccountActionResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "forbidden" | "not_found" | "unknown" };

/**
 * Disconnect the org's mailbox for a provider (spec §5.3). The row goes away, so
 * sends tied to it lose senderAccountId (FK SET NULL) and the dispatcher
 * pauses them at their next e-mail with "no_sender_account".
 */
export async function disconnectSenderAccount(provider: "MICROSOFT" | "GOOGLE"): Promise<SenderAccountActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "email") || !hasModule(ctx.modules, "marketing")) return { ok: false, error: "forbidden" };
  try {
    const db = tenantDb(ctx.organizationId);
    const row = await db.emailSenderAccount.findFirst({ where: { provider }, select: { id: true, email: true } });
    if (!row) return { ok: false, error: "not_found" };
    await db.emailSenderAccount.deleteMany({ where: { id: row.id } });
    await audit(ctx, {
      action: "email_sender.disconnected",
      entity: "EmailSenderAccount",
      entityId: row.id,
      meta: { email: row.email, provider },
    });
    revalidatePath("/app/email");
    return { ok: true };
  } catch (error) {
    console.error("Failed to disconnect the sender account", provider, error);
    return { ok: false, error: "unknown" };
  }
}
