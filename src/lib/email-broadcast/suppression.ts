import "server-only";
import type { EmailSuppressionReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "./normalize";

/**
 * Write side of the suppression list. System context (raw Prisma) because the
 * callers have no session — the unsubscribe link (HMAC-authorized) and the
 * Resend webhook (Svix-authorized) — so organizationId always comes from the
 * authorized recipient/connection row. createMany+skipDuplicates instead of
 * upsert: idempotent and inside the tenant-safe operation set.
 */
export async function suppressEmail(
  organizationId: string,
  email: string,
  reason: EmailSuppressionReason,
  recipientId?: string,
): Promise<void> {
  await prisma.emailSuppression.createMany({
    data: [{ organizationId, email: normalizeEmail(email), reason, recipientId: recipientId ?? null }],
    skipDuplicates: true,
  });
}

/** Block the address of one recipient row for its org. Never touches Contact.optedOut. */
export async function unsubscribeRecipient(recipientId: string): Promise<{ ok: boolean }> {
  const r = await prisma.emailBroadcastRecipient.findFirst({
    where: { id: recipientId },
    select: { organizationId: true, email: true },
  });
  if (!r) return { ok: false };
  await suppressEmail(r.organizationId, r.email, "UNSUBSCRIBED", recipientId);
  return { ok: true };
}
