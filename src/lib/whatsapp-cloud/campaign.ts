import "server-only";
import { LIMITS } from "@/config/limits";
import { tenantDb } from "@/lib/tenant-db";
import { looksLikeWhatsappMobile, normalizeWhatsappNumber } from "@/lib/phone";
import { loadNumber } from "@/lib/whatsapp-cloud/numbers";
import { callSend, conversationForPhone, recordOutbound } from "@/lib/whatsapp-cloud/send";
import { templatePayload } from "@/lib/whatsapp-cloud/payloads";
import {
  buildTemplateComponents,
  renderTemplateText,
  resolveParamValues,
  templateVariables,
  toTemplateDef,
  unsupportedReason,
  type ParamMapping,
} from "@/lib/whatsapp-cloud/template-params";
import { isCampaignStopper, pauseReasonText, recipientErrorText } from "@/lib/whatsapp-cloud/errors";
import { pauseCloudCampaign } from "@/lib/whatsapp-cloud/campaign-pause";

/**
 * Campanhas oficiais: disparam um modelo aprovado pelo número de quem criou a
 * campanha (as respostas caem na tela oficial dele). A Meta não bane por ritmo
 * como o QR code, então os lotes são maiores; a cota mensal é a mesma.
 */
const BATCH = 25;
const RATE_LIMIT_RETRY_SEC = 60;
const randInt = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

export type CloudCampaignLink = {
  campaignId: string;
  organizationId: string;
  numberId: string;
  templateId: string;
  params: unknown;
};

export async function findCloudCampaign(organizationId: string, campaignId: string): Promise<CloudCampaignLink | null> {
  return tenantDb(organizationId).whatsappCloudCampaign.findFirst({
    where: { campaignId },
    select: { campaignId: true, organizationId: true, numberId: true, templateId: true, params: true },
  });
}

/** Por que não dá para iniciar (null = pode). Usado por startCampaign. */
export async function cloudCampaignStartProblem(link: CloudCampaignLink): Promise<"no_connection" | "invalid" | null> {
  const number = await loadNumber(link.organizationId, link.numberId);
  if (!number || number.status !== "ACTIVE") return "no_connection";
  const tpl = await tenantDb(link.organizationId).whatsappCloudTemplate.findFirst({
    where: { id: link.templateId },
    select: { status: true },
  });
  return tpl?.status === "APPROVED" ? null : "invalid";
}

export async function clearCloudPauseReason(organizationId: string, campaignId: string): Promise<void> {
  await tenantDb(organizationId).whatsappCloudCampaign.updateMany({
    where: { campaignId },
    data: { pausedReason: null },
  });
}

export async function dispatchCloudCampaignBatch(link: CloudCampaignLink): Promise<{ done: boolean; retryAfter?: number }> {
  const { organizationId, campaignId } = link;
  const db = tenantDb(organizationId);
  const pause = async (reason: string) => {
    await pauseCloudCampaign(organizationId, campaignId, reason);
    return { done: true };
  };

  const number = await loadNumber(organizationId, link.numberId);
  if (!number || number.status !== "ACTIVE") return pause("Número oficial desconectado ou com erro.");
  const row = await db.whatsappCloudTemplate.findFirst({
    where: { id: link.templateId },
    select: { name: true, language: true, parameterFormat: true, components: true, status: true },
  });
  if (!row || row.status !== "APPROVED") return pause(`Modelo não está aprovado na Meta (${row?.status ?? "removido"}).`);
  const def = toTemplateDef(row);
  if (unsupportedReason(def)) return pause("Modelo não suportado nesta versão.");
  const vars = templateVariables(def);
  const mapping = (link.params ?? {}) as ParamMapping;

  // Cota mensal de disparos — o mesmo teto do disparo antigo.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sent = await db.campaignRecipient.count({
    where: { status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: monthStart } },
  });
  const remaining = LIMITS.dispatchQuotaPerMonth - sent;
  if (remaining <= 0) return pause("Cota mensal de disparos atingida.");

  const recipients = await db.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    orderBy: { id: "asc" },
    take: Math.min(BATCH, remaining),
    select: { id: true, contactId: true },
  });
  if (recipients.length === 0) {
    await db.campaign.updateMany({ where: { id: campaignId }, data: { status: "DONE" } });
    return { done: true };
  }
  const contacts = await db.contact.findMany({
    where: { id: { in: recipients.map((r) => r.contactId) } },
    select: { id: true, name: true, phone: true, company: { select: { name: true } } },
  });
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const fail = (id: string, error: string) =>
    db.campaignRecipient.updateMany({ where: { id }, data: { status: "FAILED", error } });

  for (const r of recipients) {
    const c = byId.get(r.contactId);
    const waId = normalizeWhatsappNumber(c?.phone ?? "");
    if (!c || !looksLikeWhatsappMobile(waId)) {
      await fail(r.id, "Número não é um WhatsApp válido.");
      continue;
    }
    const values = resolveParamValues(vars, mapping, { nome: c.name ?? "", empresa: c.company?.name ?? "" });
    const res = await callSend(
      number,
      templatePayload({ waId, bsuid: null }, def.name, def.language, buildTemplateComponents(def, values)),
    );
    if (!res.ok) {
      if (res.category === "rate_limited") return { done: false, retryAfter: RATE_LIMIT_RETRY_SEC };
      if (res.category === "pair_rate_limited") continue; // fica PENDING para o próximo lote
      if (isCampaignStopper(res.category)) return pause(pauseReasonText(res.category));
      await fail(r.id, recipientErrorText(res.category, res.message));
      continue;
    }
    await db.campaignRecipient.updateMany({
      where: { id: r.id },
      data: { status: "SENT", providerMessageId: res.wamid, error: null, sentAt: new Date() },
    });
    try {
      const conversationId = await conversationForPhone(organizationId, number.id, waId, c.id);
      await recordOutbound(organizationId, {
        conversationId,
        wamid: res.wamid,
        type: "TEMPLATE",
        body: renderTemplateText(def, values),
        templateName: def.name,
        templateLanguage: def.language,
        sentById: null,
        campaignId,
      });
    } catch (error) {
      console.error("[wa-cloud] campaign: failed to record message in inbox", error);
    }
  }

  const pending = await db.campaignRecipient.count({ where: { campaignId, status: "PENDING" } });
  if (pending === 0) {
    await db.campaign.updateMany({ where: { id: campaignId }, data: { status: "DONE" } });
    return { done: true };
  }
  return { done: false, retryAfter: randInt(2, 5) };
}
