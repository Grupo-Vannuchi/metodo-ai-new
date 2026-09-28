import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Pausa uma campanha oficial em andamento e guarda o motivo (mostrado na página
 * da campanha). Contexto de sistema: organizationId sempre explícito.
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
  const links = await prisma.whatsappCloudCampaign.findMany({
    where: { templateId: { in: templateIds } },
    select: { organizationId: true, campaignId: true },
  });
  for (const l of links) await pauseCloudCampaign(l.organizationId, l.campaignId, reason);
}
