import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CloudEvent,
  CloudInboundMessage,
  CloudInboundReaction,
  CloudStatusUpdate,
  CloudTemplateStatusUpdate,
  CloudUserIdUpdate,
} from "@/lib/whatsapp-cloud/webhook-parser";
import { nextMessageStatus } from "@/lib/whatsapp-cloud/status";
import {
  categorizeMetaError,
  isCampaignStopper,
  isNumberLevelError,
  pauseReasonText,
  recipientErrorText,
} from "@/lib/whatsapp-cloud/errors";
import { previewFor, quotedLabel } from "@/lib/whatsapp-cloud/preview";
import { templateStatusFromEvent } from "@/lib/whatsapp-cloud/template-params";
import { brPhoneVariants } from "@/lib/whatsapp-cloud/identity";
import { applyReaction } from "@/lib/whatsapp/reactions";
import { resolveContactId } from "@/lib/whatsapp/ingest";
import { scheduleMediaDownload } from "@/lib/whatsapp-cloud/media";
import { markNumberError } from "@/lib/whatsapp-cloud/numbers";
import {
  applyCloudCampaignDelivery,
  pauseCampaignsForTemplates,
  pauseCloudCampaign,
} from "@/lib/whatsapp-cloud/campaign-pause";
import { isUniqueViolation } from "@/lib/whatsapp-cloud/prisma-errors";

/**
 * Grava os eventos do webhook oficial. Contexto de sistema: a empresa vem do
 * número (phone_number_id) e entra explicitamente em todo `where`, exceto as
 * duas exceções comentadas nos pontos onde só temos um identificador da
 * própria Meta, não uma empresa: status de modelo por `wabaId`
 * (`applyTemplateStatus`) e troca de BSUID sem número conhecido
 * (`applyUserIdUpdate`). Idempotente pelo `wamid` único por empresa — a Meta
 * reenvia por até 7 dias, e a rota responde 500 quando algum evento falhou
 * (`failed > 0`) justamente para ganhar esse reenvio.
 */
type NumberRef = { id: string; organizationId: string; status: string };

const CONVO_SELECT = {
  id: true,
  bsuid: true,
  waId: true,
  contactId: true,
  lastMessageAt: true,
  lastInboundAt: true,
} as const;
type ConvoRef = { id: string; bsuid: string | null; waId: string | null; contactId: string | null; lastMessageAt: Date | null; lastInboundAt: Date | null };

/**
 * Processa cada evento isolado (um erro não impede os outros do mesmo payload) e
 * devolve quantos falharam de verdade. Número desconhecido/INACTIVE e item
 * irrelevante não são falha; conflito de índice único (reenvio) também não.
 */
export async function ingestCloudEvents(events: CloudEvent[]): Promise<{ failed: number }> {
  let failed = 0;
  const numbers = new Map<string, NumberRef | null>();
  const numberFor = async (phoneNumberId: string): Promise<NumberRef | null> => {
    if (!numbers.has(phoneNumberId)) {
      numbers.set(
        phoneNumberId,
        await prisma.whatsappCloudNumber.findFirst({
          where: { phoneNumberId },
          select: { id: true, organizationId: true, status: true },
        }),
      );
    }
    return numbers.get(phoneNumberId) ?? null;
  };

  for (const e of events) {
    try {
      if (e.kind === "template_status") {
        await applyTemplateStatus(e);
        continue;
      }
      if (e.kind === "user_id_update") {
        await applyUserIdUpdate(e, e.phoneNumberId ? await numberFor(e.phoneNumberId) : null);
        continue;
      }
      const number = await numberFor(e.phoneNumberId);
      if (!number || number.status === "INACTIVE") continue;
      if (e.kind === "message") await ingestMessage(number, e);
      else if (e.kind === "reaction") await ingestReaction(number, e);
      else await applyStatus(number, e);
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      failed++;
      console.error(`[wa-cloud] failed to ingest ${e.kind}`, error);
    }
  }
  return { failed };
}

async function findConversation(number: NumberRef, bsuid: string | null, waId: string | null): Promise<ConvoRef | null> {
  const or: Prisma.WhatsappCloudConversationWhereInput[] = [];
  if (bsuid) or.push({ bsuid });
  // Celular brasileiro chega com ou sem o 9º dígito: as duas formas são o mesmo cliente.
  if (waId) or.push({ waId: { in: brPhoneVariants(waId) } });
  if (or.length === 0) return null;
  return prisma.whatsappCloudConversation.findFirst({
    where: { organizationId: number.organizationId, numberId: number.id, OR: or },
    select: CONVO_SELECT,
  });
}

/** Preenche o identificador que faltava. Choque de índice único (outra conversa já o tem) é ignorado. */
async function backfillIdentity(
  organizationId: string,
  convo: ConvoRef,
  ids: { bsuid: string | null; waId: string | null; profileName?: string | null; username?: string | null },
): Promise<void> {
  const data: Prisma.WhatsappCloudConversationUpdateManyMutationInput = {};
  if (ids.bsuid && !convo.bsuid) data.bsuid = ids.bsuid;
  if (ids.waId && !convo.waId) data.waId = ids.waId;
  if (ids.profileName) data.profileName = ids.profileName;
  if (ids.username) data.username = ids.username;
  if (Object.keys(data).length === 0) return;
  try {
    await prisma.whatsappCloudConversation.updateMany({ where: { id: convo.id, organizationId }, data });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

async function ingestMessage(number: NumberRef, m: CloudInboundMessage): Promise<void> {
  const orgId = number.organizationId;
  let convo = await findConversation(number, m.bsuid, m.waId);
  if (!convo) {
    // Só com telefone vira contato do CRM (mesma regra do inbox atual); cliente
    // só com nome de usuário não cria contato.
    const contactId = m.waId ? await resolveContactId(orgId, m.waId, m.profileName) : null;
    try {
      convo = await prisma.whatsappCloudConversation.create({
        data: {
          organizationId: orgId,
          numberId: number.id,
          bsuid: m.bsuid,
          waId: m.waId,
          username: m.username,
          profileName: m.profileName,
          contactId,
        },
        select: CONVO_SELECT,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      convo = await findConversation(number, m.bsuid, m.waId);
      if (!convo) throw error;
    }
  } else {
    await backfillIdentity(orgId, convo, m);
    if (!convo.contactId && m.waId) {
      const contactId = await resolveContactId(orgId, m.waId, m.profileName);
      if (contactId) {
        await prisma.whatsappCloudConversation.updateMany({
          where: { id: convo.id, organizationId: orgId },
          data: { contactId },
        });
      }
    }
  }

  let quotedBody: string | null = null;
  if (m.quotedWamid) {
    const q = await prisma.whatsappCloudMessage.findFirst({
      where: { organizationId: orgId, wamid: m.quotedWamid },
      select: { body: true, type: true },
    });
    quotedBody = q ? quotedLabel(q.type, q.body) : null;
  }

  const newest = !convo.lastMessageAt || m.timestamp >= convo.lastMessageAt;
  const inboundNewest = !convo.lastInboundAt || m.timestamp > convo.lastInboundAt;
  let messageId: string;
  try {
    // Mensagem + contador/prévia da conversa numa transação só: ou os dois
    // entram, ou nenhum (e o reenvio da Meta completa o que faltou).
    const [created] = await prisma.$transaction([
      prisma.whatsappCloudMessage.create({
        data: {
          organizationId: orgId,
          conversationId: convo.id,
          wamid: m.wamid,
          direction: "INBOUND",
          type: m.type,
          body: m.body,
          payload: m.extra as Prisma.InputJsonValue,
          ...(m.media
            ? { mediaId: m.media.id, mediaMime: m.media.mime, mediaName: m.media.filename, mediaStatus: "PENDING" as const }
            : {}),
          quotedWamid: m.quotedWamid,
          quotedBody,
          timestamp: m.timestamp,
        },
        select: { id: true },
      }),
      prisma.whatsappCloudConversation.updateMany({
        where: { id: convo.id, organizationId: orgId },
        data: {
          unreadCount: { increment: 1 },
          ...(inboundNewest ? { lastInboundAt: m.timestamp } : {}),
          ...(newest ? { lastMessageAt: m.timestamp, lastMessagePreview: previewFor(m.type, m.body) } : {}),
        },
      }),
    ]);
    messageId = created.id;
  } catch (error) {
    if (isUniqueViolation(error)) return; // reenvio da Meta: já gravada, não conta de novo
    throw error;
  }
  if (m.media) scheduleMediaDownload(orgId, messageId);
}

async function ingestReaction(number: NumberRef, r: CloudInboundReaction): Promise<void> {
  const target = await prisma.whatsappCloudMessage.findFirst({
    where: { organizationId: number.organizationId, wamid: r.targetWamid, conversation: { numberId: number.id } },
    select: { id: true, reactions: true },
  });
  if (!target) return;
  const reactions = applyReaction(target.reactions, { emoji: r.emoji, fromMe: false, senderName: null });
  await prisma.whatsappCloudMessage.updateMany({
    where: { id: target.id, organizationId: number.organizationId },
    data: { reactions: reactions as Prisma.InputJsonValue },
  });
}

async function applyStatus(number: NumberRef, s: CloudStatusUpdate): Promise<void> {
  const orgId = number.organizationId;
  const msg = await prisma.whatsappCloudMessage.findFirst({
    where: { organizationId: orgId, wamid: s.wamid },
    select: { id: true, status: true, conversationId: true, campaignId: true },
  });
  const category = s.status === "FAILED" ? categorizeMetaError(s.errorCode) : null;

  if (msg) {
    const next = nextMessageStatus(msg.status, s.status);
    const data: Prisma.WhatsappCloudMessageUpdateManyMutationInput = {};
    if (next) data.status = next;
    if (next === "FAILED") {
      data.errorCode = s.errorCode;
      data.errorMessage = s.errorMessage;
    }
    if (s.pricingCategory) data.pricingCategory = s.pricingCategory;
    if (s.pricingType) data.pricingType = s.pricingType;
    if (Object.keys(data).length > 0) {
      await prisma.whatsappCloudMessage.updateMany({ where: { id: msg.id, organizationId: orgId }, data });
    }
    const convo = await prisma.whatsappCloudConversation.findFirst({
      where: { id: msg.conversationId, organizationId: orgId },
      select: CONVO_SELECT,
    });
    if (convo) await backfillIdentity(orgId, convo, { bsuid: s.bsuid, waId: s.waId });
    if (category && msg.campaignId && isCampaignStopper(category)) {
      await pauseCloudCampaign(orgId, msg.campaignId, pauseReasonText(category));
    }
  }

  if (category && isNumberLevelError(category)) {
    await markNumberError(orgId, number.id, s.errorMessage ?? category);
  }

  if (s.status !== "SENT") {
    await applyCloudCampaignDelivery(
      orgId,
      s.wamid,
      s.status,
      category ? recipientErrorText(category, s.errorMessage) : null,
    );
  }
}

async function applyTemplateStatus(t: CloudTemplateStatusUpdate): Promise<void> {
  // O mesmo modelo da Meta pode estar espelhado em mais de uma empresa que tem a
  // mesma WABA; todas recebem o status (a WABA identifica a conta na Meta).
  const rows = await prisma.whatsappCloudTemplate.findMany({
    where: { wabaId: t.wabaId, name: t.name, language: t.language },
    select: { id: true },
  });
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  // `t.status` é o EVENTO da Meta: FLAGGED/IN_APPEAL/etc. não mudam o status gravado.
  const status = templateStatusFromEvent(t.status);
  if (status === null) {
    if (t.reason) {
      await prisma.whatsappCloudTemplate.updateMany({ where: { id: { in: ids } }, data: { rejectedReason: t.reason } });
    }
    return;
  }
  await prisma.whatsappCloudTemplate.updateMany({
    where: { id: { in: ids } },
    data: { status, rejectedReason: t.reason },
  });
  if (status === "PAUSED") await pauseCampaignsForTemplates(ids, pauseReasonText("template_paused"));
  if (status === "DISABLED") await pauseCampaignsForTemplates(ids, pauseReasonText("template_disabled"));
}

async function applyUserIdUpdate(u: CloudUserIdUpdate, number: NumberRef | null): Promise<void> {
  try {
    // O evento de troca de BSUID não traz empresa — só um `phone_number_id`
    // opcional que pode não resolver a nenhum número nosso. Quando o número é
    // conhecido, o filtro já isola por numberId + organizationId (caso normal).
    // Sem número conhecido, o filtro cai para o bsuid sozinho: um BSUID
    // identifica um único usuário da Meta, então o pior caso é atualizar a
    // conversa de outra empresa que por coincidência tenha o mesmo bsuid
    // antigo — aceito como exceção documentada no docstring do módulo.
    await prisma.whatsappCloudConversation.updateMany({
      where: {
        bsuid: u.previousBsuid,
        ...(number ? { numberId: number.id, organizationId: number.organizationId } : {}),
      },
      data: { bsuid: u.currentBsuid },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}
