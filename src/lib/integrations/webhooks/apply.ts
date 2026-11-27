import "server-only";
import { prisma } from "@/lib/prisma";
import {
  resolveTransition,
  type DeliveryUpdate,
  type RecipientStatusName,
} from "@/lib/integrations/webhooks/delivery";

/**
 * Apply provider delivery acks to campaign recipients of `organizationId` (the
 * org of the connection that sent the webhook). Matches by the provider's
 * message id and only moves status forward. Scoped by org so a connection's
 * webhook can't move another company's recipients, even knowing a message id.
 */
export async function applyCampaignDeliveryUpdates(
  organizationId: string,
  updates: DeliveryUpdate[],
): Promise<void> {
  for (const u of updates) {
    const recipients = await prisma.campaignRecipient.findMany({
      where: { providerMessageId: u.providerMessageId, organizationId },
      select: { id: true, status: true },
    });
    for (const r of recipients) {
      const next = resolveTransition(r.status as RecipientStatusName, u.status);
      if (!next) continue;
      await prisma.campaignRecipient.updateMany({
        where: { id: r.id, organizationId },
        data: {
          status: next,
          ...(next === "FAILED"
            ? { error: u.error || "Falha relatada pelo provedor." }
            : {}),
        },
      });
    }
  }
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
