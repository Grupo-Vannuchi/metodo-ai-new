import "server-only";
import { tenantDb } from "@/lib/tenant-db";

/** Modelo e motivo de pausa de uma campanha oficial (null = campanha comum). */
export async function getCloudCampaignInfo(organizationId: string, campaignId: string) {
  const db = tenantDb(organizationId);
  const link = await db.whatsappCloudCampaign.findFirst({
    where: { campaignId },
    select: { templateId: true, pausedReason: true },
  });
  if (!link) return null;
  const tpl = await db.whatsappCloudTemplate.findFirst({
    where: { id: link.templateId },
    select: { name: true, language: true },
  });
  return { templateName: tpl ? `${tpl.name} (${tpl.language})` : null, pausedReason: link.pausedReason };
}
