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
import { isWhatsappCloudEnabled } from "@/lib/whatsapp-cloud/rollout";

/**
 * Campanhas oficiais: disparam um modelo aprovado pelo número de quem criou a
 * campanha (as respostas caem na tela oficial dele). A Meta não bane por ritmo
 * como o QR code, então os lotes são maiores; a cota mensal é a mesma.
 *
 * Cada destinatário é RESERVADO antes da chamada à Meta (`sentAt` preenchido
 * com o status ainda PENDING): duas cadeias de disparo em paralelo nunca pagam o
 * mesmo modelo duas vezes. Reserva de lote que morreu vence em 10 minutos.
 */
const BATCH = 25;
const RATE_LIMIT_RETRY_SEC = 60;
const CLAIM_STALE_MS = 10 * 60 * 1000;
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

export type CloudStartProblem = "not_enabled" | "no_connection" | "not_owner" | "invalid" | "already_sent";

/**
 * Por que `userId` não pode iniciar ou retomar a campanha (null = pode). Usado por
 * startCampaign. Cada modelo enviado é cobrado na conta do número na Meta, então:
 * - fora do piloto (WHATSAPP_CLOUD_ORG_IDS), nada sai;
 * - a campanha sai do número de quem o conectou: só o dono dele a dispara;
 * - sem ninguém na fila, ela já foi enviada e não recomeça do zero (para enviar de
 *   novo, cria-se outra campanha).
 */
export async function cloudCampaignStartProblem(
  link: CloudCampaignLink,
  userId: string,
): Promise<CloudStartProblem | null> {
  if (!isWhatsappCloudEnabled(link.organizationId)) return "not_enabled";
  const number = await loadNumber(link.organizationId, link.numberId);
  if (!number || number.status !== "ACTIVE") return "no_connection";
  if (number.ownerId !== userId) return "not_owner";
  const db = tenantDb(link.organizationId);
  const tpl = await db.whatsappCloudTemplate.findFirst({
    where: { id: link.templateId },
    select: { status: true },
  });
  if (tpl?.status !== "APPROVED") return "invalid";
  const pending = await db.campaignRecipient.count({ where: { campaignId: link.campaignId, status: "PENDING" } });
  return pending === 0 ? "already_sent" : null;
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

  // Tirar a empresa de WHATSAPP_CLOUD_ORG_IDS é o freio: a cadeia em andamento
  // para no próximo lote, e só volta pelo "Retomar" do dono com a empresa na lista.
  if (!isWhatsappCloudEnabled(organizationId)) return pause("A empresa saiu do piloto do WhatsApp oficial.");
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

  // Livre = PENDING sem reserva, ou com reserva vencida (lote que morreu no meio).
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);
  const claimable = {
    status: "PENDING" as const,
    OR: [{ sentAt: null }, { sentAt: { lt: staleBefore } }],
  };
  const recipients = await db.campaignRecipient.findMany({
    where: { campaignId, ...claimable },
    orderBy: { id: "asc" },
    take: Math.min(BATCH, remaining),
    select: { id: true, contactId: true },
  });
  if (recipients.length === 0) {
    // Sobrou só destinatário reservado por outra cadeia em andamento: ela termina
    // a campanha. Marcar DONE aqui deixaria para trás quem ela devolver à fila.
    const reserved = await db.campaignRecipient.count({ where: { campaignId, status: "PENDING" } });
    if (reserved === 0) await db.campaign.updateMany({ where: { id: campaignId }, data: { status: "DONE" } });
    return { done: true };
  }
  const contacts = await db.contact.findMany({
    where: { id: { in: recipients.map((r) => r.contactId) } },
    select: { id: true, name: true, phone: true, company: { select: { name: true } } },
  });
  const byId = new Map(contacts.map((c) => [c.id, c]));
  // FAILED sem data de envio, como no disparo antigo (a reserva não é envio).
  const fail = (id: string, error: string) =>
    db.campaignRecipient.updateMany({ where: { id }, data: { status: "FAILED", error, sentAt: null } });
  // Devolve à fila: continua PENDING e sem reserva, para o próximo lote.
  const release = (id: string) =>
    db.campaignRecipient.updateMany({ where: { id, status: "PENDING" }, data: { sentAt: null } });

  for (const r of recipients) {
    const claim = await db.campaignRecipient.updateMany({
      where: { id: r.id, ...claimable },
      data: { sentAt: new Date() },
    });
    if (claim.count === 0) continue; // outra cadeia já pegou este destinatário
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
      if (res.category === "uncertain") {
        // Sem resposta da Meta: a mensagem pode ter saído e sido cobrada. Nunca
        // volta à fila (reenviar cobraria duas vezes). A campanha para, para uma
        // Meta fora do ar não marcar a lista inteira como falha, um por um.
        await fail(r.id, recipientErrorText(res.category, res.message));
        return pause(pauseReasonText(res.category));
      }
      if (res.category === "dev_guard") {
        await fail(r.id, recipientErrorText(res.category, res.message));
        continue;
      }
      // 130429 e os códigos em que a Meta diz que falhou (131000, 131016): nada saiu.
      if (res.category === "rate_limited" || res.category === "transient") {
        await release(r.id);
        return { done: false, retryAfter: RATE_LIMIT_RETRY_SEC };
      }
      if (res.category === "pair_rate_limited") {
        await release(r.id); // fica PENDING para o próximo lote
        continue;
      }
      if (isCampaignStopper(res.category)) {
        await release(r.id); // não foi enviado: volta com a campanha retomada
        return pause(pauseReasonText(res.category));
      }
      await fail(r.id, recipientErrorText(res.category, res.message));
      continue;
    }
    await db.campaignRecipient.updateMany({
      where: { id: r.id },
      data: { status: "SENT", providerMessageId: res.wamid, error: null, sentAt: new Date() },
    });
    try {
      const conversationId = await conversationForPhone(organizationId, number.id, res.waId ?? waId, c.id, res.bsuid);
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
