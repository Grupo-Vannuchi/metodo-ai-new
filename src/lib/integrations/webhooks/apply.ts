import "server-only";
import { prisma } from "@/lib/prisma";
import {
  resolveTransition,
  type DeliveryUpdate,
  type RecipientStatusName,
} from "@/lib/integrations/webhooks/delivery";

/**
 * Apply provider delivery acks to campaign recipients. Matches by the provider's
 * message id and only moves status forward. Returns the matched org (to stamp on
 * the webhook event) or null. Used by both webhook routes.
 */
export async function applyCampaignDeliveryUpdates(
  updates: DeliveryUpdate[],
): Promise<string | null> {
  let orgId: string | null = null;
  for (const u of updates) {
    const recipients = await prisma.campaignRecipient.findMany({
      where: { providerMessageId: u.providerMessageId },
      select: { id: true, status: true, organizationId: true },
    });
    for (const r of recipients) {
      orgId ??= r.organizationId;
      const next = resolveTransition(r.status as RecipientStatusName, u.status);
      if (!next) continue;
      await prisma.campaignRecipient.update({
        where: { id: r.id },
        data: {
          status: next,
          ...(next === "FAILED"
            ? { error: u.error || "Falha relatada pelo provedor." }
            : {}),
        },
      });
    }
  }
  return orgId;
}

/** Apply the same delivery acks to inbox messages (outbound message status). */
export async function applyInboxMessageStatus(
  organizationId: string,
  updates: DeliveryUpdate[],
): Promise<void> {
  for (const u of updates) {
    const msg = await prisma.message.findFirst({
      where: { providerMessageId: u.providerMessageId, organizationId },
      select: { id: true, status: true },
    });
    if (!msg) continue;
    const next = resolveTransition((msg.status ?? "SENT") as RecipientStatusName, u.status);
    if (next) {
      await prisma.message.update({ where: { id: msg.id }, data: { status: next } });
    }
  }
}
