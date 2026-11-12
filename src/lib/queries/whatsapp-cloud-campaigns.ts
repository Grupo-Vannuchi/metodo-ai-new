import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/**
 * Modelo, motivo de pausa e dono do número de uma campanha oficial (null =
 * campanha comum). O dono é quem pode dispará-la (ver cloudCampaignStartProblem).
 */
export async function getCloudCampaignInfo(organizationId: string, campaignId: string) {
  const db = tenantDb(organizationId);
  const link = await db.whatsappCloudCampaign.findFirst({
    where: { campaignId },
    select: { templateId: true, numberId: true, pausedReason: true },
  });
  if (!link) return null;
  const [tpl, number] = await Promise.all([
    db.whatsappCloudTemplate.findFirst({
      where: { id: link.templateId },
      select: { name: true, language: true },
    }),
    db.whatsappCloudNumber.findFirst({ where: { id: link.numberId }, select: { ownerId: true } }),
  ]);
  return {
    templateName: tpl ? `${tpl.name} (${tpl.language})` : null,
    pausedReason: link.pausedReason,
    numberOwnerId: number?.ownerId ?? null,
  };
}
