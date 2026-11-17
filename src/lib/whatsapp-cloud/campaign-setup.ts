import "server-only";
import type { OrgContext } from "@/lib/tenant";
import { hasFeatureByModules } from "@/config/modules";
import { isWhatsappCloudEnabled } from "@/lib/whatsapp-cloud/rollout";
import { getMyCloudNumber, listCloudTemplates } from "@/lib/queries/inbox-oficial";
import { loadNumber } from "@/lib/whatsapp-cloud/numbers";
import { getMessagingLimit } from "@/lib/whatsapp-cloud/meta-api";
import { toTemplateOption, type CloudTemplateOption } from "@/lib/whatsapp-cloud/template-params";

export type CloudCampaignSetup = { templates: CloudTemplateOption[]; messagingLimit: string | null };

/**
 * O que o formulário de campanha precisa para o canal oficial. `null` = o
 * formulário de hoje, sem mudança nenhuma (empresa fora do piloto, sem o
 * recurso de campanhas WhatsApp ou sem número oficial ativo). Resolvido no
 * servidor e passado como prop (gating cross-módulo, guia 04).
 */
export async function cloudCampaignSetup(ctx: OrgContext): Promise<CloudCampaignSetup | null> {
  if (!isWhatsappCloudEnabled(ctx.organizationId)) return null;
  if (!hasFeatureByModules(ctx.modules, "campaigns.whatsapp")) return null;
  const number = await getMyCloudNumber(ctx.organizationId, ctx.userId);
  if (!number || number.status !== "ACTIVE") return null;
  const rows = await listCloudTemplates(ctx.organizationId, number.wabaId, { approvedOnly: true });
  const withToken = await loadNumber(ctx.organizationId, number.id);
  const messagingLimit = withToken ? await getMessagingLimit(withToken.phoneNumberId, withToken.token) : null;
  return { templates: rows.map((r) => toTemplateOption(r)), messagingLimit };
}
