import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveTransition, type RecipientStatusName } from "@/lib/integrations/webhooks/delivery";

/**
 * Pausa uma campanha oficial (por erro de status ou por modelo pausado/
 * desativado na Meta) e aplica o status de entrega ao destinatário. Contexto de
 * sistema: organizationId sempre explícito em todo `where`, exceto o
 * `findMany` de `pauseCampaignsForTemplates` — ele busca por `templateId` (id
 * de linha já isolado por empresa na origem, em `applyTemplateStatus`) para
 * descobrir a qual empresa cada campanha vinculada pertence; cada pausa que
 * ele dispara em seguida volta a filtrar por organizationId em
 * `pauseCloudCampaign`.
 */
export async function pauseCloudCampaign(organizationId: string, campaignId: string, reason: string): Promise<void> {
  const res = await prisma.campaign.updateMany({
    where: { id: campaignId, organizationId, status: "RUNNING" },
    data: { status: "PAUSED" },
  });
  if (res.count === 0) return;
  await prisma.whatsappCloudCampaign.updateMany({
    where: { campaignId, organizationId },
    data: { pausedReason: reason },
  });
}

/** A Meta pausou/desativou um modelo: pausa toda campanha em andamento que o usa. */
export async function pauseCampaignsForTemplates(templateIds: string[], reason: string): Promise<void> {
  if (templateIds.length === 0) return;
  // Sem organizationId aqui de propósito: `templateIds` já são ids de linha de
  // WhatsappCloudTemplate isolados por empresa na origem; o papel deste
  // findMany é justamente descobrir a qual empresa cada campanha vinculada
  // pertence. Cada pausa disparada a seguir volta a filtrar por
  // organizationId em pauseCloudCampaign.
  const links = await prisma.whatsappCloudCampaign.findMany({
    where: { templateId: { in: templateIds } },
    select: { organizationId: true, campaignId: true },
  });
  for (const l of links) await pauseCloudCampaign(l.organizationId, l.campaignId, reason);
}

/**
 * Aplica o status de entrega da Meta a um destinatário de campanha oficial —
 * versão isolada por empresa de `applyCampaignDeliveryUpdates`
 * (src/lib/integrations/webhooks/apply.ts), que não filtra por
 * organizationId porque atende também o fluxo Evolution (não mexido aqui).
 * Usada só pelo caminho da Cloud API, onde a empresa já é conhecida (vem do
 * `phone_number_id`).
 */
export async function applyCloudCampaignDelivery(
  organizationId: string,
  wamid: string,
  status: "DELIVERED" | "READ" | "FAILED",
  error: string | null,
): Promise<void> {
  const recipients = await prisma.campaignRecipient.findMany({
    where: { organizationId, providerMessageId: wamid },
    select: { id: true, status: true },
  });
  for (const r of recipients) {
    const next = resolveTransition(r.status as RecipientStatusName, status);
    if (!next) continue;
    await prisma.campaignRecipient.updateMany({
      where: { id: r.id, organizationId },
      data: {
        status: next,
        ...(next === "FAILED" ? { error: error ?? "Falha relatada pelo provedor." } : {}),
      },
    });
  }
}
